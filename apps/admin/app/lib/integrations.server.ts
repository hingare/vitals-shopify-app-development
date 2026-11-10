import {
  EMAIL_TOOLS,
  IntegrationError,
  SMS_GATEWAYS,
  isEmailToolId,
  type Contact,
  type ContactEvent,
  type EmailToolId,
  type SmsConfig,
  type SmsGatewayId,
} from "@app/integrations";
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { encryptSecret, maskSecret, readSecretJson } from "./crypto.server";
import { SKIP_LIST, SYNC_SOURCES, type SyncSource } from "./integration-options";
import { enqueueJob, registerJob } from "./queue.server";

export { SKIP_LIST, SYNC_SOURCES, type SyncSource };

/**
 * বাইরের সার্ভিসের সংযোগ: ইমেইল টুল (Klaviyo, Mailchimp, Omnisend) আর SMS gateway।
 * চাবি এনক্রিপ্ট হয়ে ডাটাবেসে থাকে আর কখনো ব্রাউজারে ফেরত যায় না (শুধু শেষ ৪ অক্ষর দেখানো হয়)।
 * সিঙ্ক ব্যাকগ্রাউন্ড কাজ হিসেবে চলে: ব্যর্থ হলে আবার চেষ্টা হয়, আর ত্রুটি Integrations পেজে দেখায়।
 */

export interface EspConfig {
  defaultList: string;
  lists: Record<string, string>;
}

export function readEspConfig(raw: unknown): EspConfig {
  const value = (raw ?? {}) as { defaultList?: unknown; lists?: unknown };
  const lists: Record<string, string> = {};
  if (value.lists && typeof value.lists === "object") {
    for (const source of SYNC_SOURCES) {
      const id = (value.lists as Record<string, unknown>)[source];
      if (typeof id === "string" && id.length <= 100) lists[source] = id;
    }
  }
  return {
    defaultList: typeof value.defaultList === "string" ? value.defaultList.slice(0, 100) : "",
    lists,
  };
}

/** এই উৎসের গ্রাহক কোন লিস্টে যাবে; `skip` হলে পাঠানোই হবে না */
export function listFor(
  config: EspConfig,
  source: string,
): { skip: boolean; listId: string | null } {
  const chosen = config.lists[source] ?? "";
  if (chosen === SKIP_LIST) return { skip: true, listId: null };
  return { skip: false, listId: chosen || config.defaultList || null };
}

interface KeySecret {
  apiKey: string;
  customUrl?: string;
}

/* ------------------------------------------------------------------ */
/* সংযোগ করা, দেখা, বিচ্ছিন্ন করা                                       */
/* ------------------------------------------------------------------ */

export async function connectEmailTool(shopId: string, provider: EmailToolId, apiKey: string) {
  const key = apiKey.trim();
  if (key.length < 8 || key.length > 200) {
    throw new IntegrationError("Enter the API key", 400, false);
  }
  await EMAIL_TOOLS[provider].validate(key);
  const secret = encryptSecret(JSON.stringify({ apiKey: key } satisfies KeySecret));
  await db.integration.upsert({
    where: { shopId_provider: { shopId, provider } },
    create: { shopId, provider, secret },
    update: { secret, status: "connected", lastError: null },
  });
}

export async function disconnectIntegration(shopId: string, provider: string) {
  await db.integration.deleteMany({ where: { shopId, provider } });
}

export async function saveEspConfig(shopId: string, provider: EmailToolId, raw: unknown) {
  await db.integration.updateMany({
    where: { shopId, provider },
    data: { config: readEspConfig(raw) as unknown as Prisma.InputJsonValue },
  });
}

/** অ্যাডমিন পেজের জন্য: চাবি ঢাকা, শুধু অবস্থা আর সেটিংস */
export async function listIntegrations(shopId: string) {
  const rows = await db.integration.findMany({ where: { shopId } });
  return rows.map((row) => ({
    provider: row.provider,
    status: row.status,
    lastError: row.lastError,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    keyHint: maskSecret(readSecretJson<KeySecret>(row.secret)?.apiKey ?? ""),
    config: row.config as Record<string, unknown>,
  }));
}

async function espKey(shopId: string, provider: EmailToolId) {
  const row = await db.integration.findUnique({
    where: { shopId_provider: { shopId, provider } },
  });
  const apiKey = readSecretJson<KeySecret>(row?.secret)?.apiKey;
  return row && apiKey ? { apiKey, config: readEspConfig(row.config) } : null;
}

/** সংযুক্ত টুলের লিস্টগুলো (সরাসরি সেই সার্ভিস থেকে) */
export async function providerLists(shopId: string, provider: EmailToolId) {
  const esp = await espKey(shopId, provider);
  if (!esp || !EMAIL_TOOLS[provider].hasLists) return [];
  return EMAIL_TOOLS[provider].lists(esp.apiKey);
}

/* ------------------------------------------------------------------ */
/* সিঙ্ক (ব্যাকগ্রাউন্ড কাজ)                                            */
/* ------------------------------------------------------------------ */

type SyncPayload =
  | { provider: string; action: "subscribe"; contact: Contact }
  | { provider: string; action: "unsubscribe"; email: string; source: string }
  | { provider: string; action: "event"; event: ContactEvent; source: string };

async function connectedProviders(shopId: string): Promise<string[]> {
  const rows = await db.integration.findMany({
    where: { shopId, provider: { in: Object.keys(EMAIL_TOOLS) } },
    select: { provider: true },
  });
  return rows.map((r) => r.provider);
}

/** নতুন গ্রাহককে সংযুক্ত প্রতিটা ইমেইল টুলে পাঠানোর কাজ লাইনে দেয় */
export async function queueContactSync(shopId: string, contact: Contact) {
  for (const provider of await connectedProviders(shopId)) {
    await enqueueJob(shopId, "esp-sync", { provider, action: "subscribe", contact });
  }
}

export async function queueUnsubscribeSync(shopId: string, email: string, source = "shopify") {
  for (const provider of await connectedProviders(shopId)) {
    await enqueueJob(shopId, "esp-sync", { provider, action: "unsubscribe", email, source });
  }
}

/** ইভেন্ট (Spin won, Back in stock requested ...), যা দিয়ে মার্চেন্ট নিজের টুলে flow বানাতে পারেন */
export async function queueEvent(shopId: string, source: SyncSource, event: ContactEvent) {
  for (const provider of await connectedProviders(shopId)) {
    await enqueueJob(shopId, "esp-sync", { provider, action: "event", event, source });
  }
}

async function markResult(shopId: string, provider: string, error: string | null) {
  await db.integration.updateMany({
    where: { shopId, provider },
    data: error
      ? { status: "error", lastError: error.slice(0, 300) }
      : { status: "connected", lastError: null, lastSyncAt: new Date() },
  });
}

export async function runEspSync(shopId: string, payload: SyncPayload) {
  if (!isEmailToolId(payload.provider)) return;
  const esp = await espKey(shopId, payload.provider);
  if (!esp) return; // এর মধ্যে সংযোগ সরিয়ে ফেলা হয়েছে
  const adapter = EMAIL_TOOLS[payload.provider];
  const source = payload.action === "subscribe" ? payload.contact.source : payload.source;
  const { skip, listId } = listFor(esp.config, source);
  if (skip) return;
  try {
    if (payload.action === "subscribe")
      await adapter.subscribe(esp.apiKey, listId, payload.contact);
    else if (payload.action === "unsubscribe") {
      await adapter.unsubscribe(esp.apiKey, listId, payload.email);
    } else await adapter.event(esp.apiKey, listId, payload.event);
    await markResult(shopId, payload.provider, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markResult(shopId, payload.provider, message);
    // সাময়িক সমস্যা (রেট লিমিট, নেটওয়ার্ক) হলে কাজটা আবার চেষ্টা হবে; ভুল চাবি বা লিস্ট হলে থামে
    if (!(error instanceof IntegrationError) || error.retryable) throw error;
  }
}

registerJob("esp-sync", (job) => runEspSync(job.shopId, job.payload as unknown as SyncPayload));

/** "সব গ্রাহক এখন পাঠাও": ৫০ জন করে, যাতে সার্ভিসের রেট লিমিট না ছাড়ায় */
registerJob("esp-backfill", async (job) => {
  const {
    provider,
    cursor = "",
    done = 0,
  } = job.payload as {
    provider: string;
    cursor?: string;
    done?: number;
  };
  if (!isEmailToolId(provider)) return;
  const batch = await db.subscriber.findMany({
    where: { shopId: job.shopId, status: "subscribed", id: { gt: cursor } },
    orderBy: { id: "asc" },
    take: 50,
  });
  for (const sub of batch) {
    await runEspSync(job.shopId, {
      provider,
      action: "subscribe",
      contact: { email: sub.email, firstName: sub.firstName ?? undefined, source: sub.source },
    });
  }
  const total = done + batch.length;
  if (batch.length < 50) return { progress: { done: total } };
  return {
    again: true,
    delayMs: 5000,
    payload: { provider, cursor: batch[batch.length - 1]?.id ?? cursor, done: total },
    progress: { done: total },
  };
});

/* ------------------------------------------------------------------ */
/* SMS gateway                                                         */
/* ------------------------------------------------------------------ */

export const SMS_PROVIDER = "sms";

export interface SmsGatewayInput {
  gateway: string;
  apiKey: string;
  senderId: string;
  customUrl: string;
  customSuccess: string;
}

/** চাবি বা লিংক ফাঁকা রাখলে আগেরটাই থাকে (মার্চেন্টকে প্রতিবার চাবি আবার লিখতে হয় না) */
export async function saveSmsGateway(shopId: string, input: SmsGatewayInput) {
  if (!(SMS_GATEWAYS as readonly string[]).includes(input.gateway)) {
    throw new IntegrationError("Choose an SMS gateway", 400, false);
  }
  const existing = await db.integration.findUnique({
    where: { shopId_provider: { shopId, provider: SMS_PROVIDER } },
  });
  const old = readSecretJson<KeySecret>(existing?.secret);
  const apiKey = input.apiKey.trim() || old?.apiKey || "";
  const customUrl = input.customUrl.trim() || old?.customUrl || "";
  if (!apiKey) throw new IntegrationError("Enter the gateway's API key", 400, false);
  if (input.gateway === "custom" && !/^https:\/\/\S+$/.test(customUrl)) {
    throw new IntegrationError("The gateway link must start with https://", 400, false);
  }
  if (input.gateway === "custom" && !customUrl.includes("{to}")) {
    throw new IntegrationError("The gateway link needs {to} and {message}", 400, false);
  }
  const secret = encryptSecret(JSON.stringify({ apiKey, customUrl } satisfies KeySecret));
  const config = {
    gateway: input.gateway,
    senderId: input.senderId.trim().slice(0, 30),
    customSuccess: input.customSuccess.trim().slice(0, 60),
    // মার্চেন্ট শেষ কবে সেভ করেছেন (পেজ এটা দেখে ফর্ম নতুন করে শুরু করে)
    savedAt: new Date().toISOString(),
  };
  await db.integration.upsert({
    where: { shopId_provider: { shopId, provider: SMS_PROVIDER } },
    create: { shopId, provider: SMS_PROVIDER, secret, config },
    update: { secret, config, status: "connected", lastError: null },
  });
}

export async function smsGateway(shopId: string): Promise<SmsConfig | null> {
  const row = await db.integration.findUnique({
    where: { shopId_provider: { shopId, provider: SMS_PROVIDER } },
  });
  const secret = readSecretJson<KeySecret>(row?.secret);
  if (!row || !secret?.apiKey) return null;
  const config = row.config as { gateway?: string; senderId?: string; customSuccess?: string };
  return {
    gateway: (config.gateway ?? "custom") as SmsGatewayId,
    apiKey: secret.apiKey,
    senderId: config.senderId,
    customUrl: secret.customUrl,
    customSuccess: config.customSuccess,
  };
}

export { markResult as markIntegrationResult };
