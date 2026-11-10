import { sendSms, type SmsConfig, type SmsResult } from "@app/integrations";
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import {
  emailContentSchema,
  fillContent,
  readEmailSettings,
  renderEmail,
  type EmailContent,
} from "./email-template";
import { sendEmail, type OutgoingEmail, type SendResult } from "./email-transport.server";
import { queueUnsubscribeSync, smsGateway } from "./integrations.server";
import { clickUrl, openPixelUrl, unsubscribeUrl } from "./links.server";
import { EMAIL_MONTHLY_CAP } from "./plans";
import { enqueueJob } from "./queue.server";

/**
 * সব ইমেইল আর SMS আগে `Message` টেবিলে লাইনে পড়ে, তারপর ব্যাকগ্রাউন্ডে যায়।
 * পাঠানোর ঠিক আগে প্রতিবার দেখা হয়: মাসের সীমা, গ্রাহক এখনো রাজি কিনা, ঠিকানা থেকে আগে bounce এসেছে কিনা।
 * তাই লাইনে দেওয়ার পরে কেউ আনসাবস্ক্রাইব করলেও তার কাছে আর যায় না।
 */
export type EmailPayload = {
  /** মার্কেটিং হলে আনসাবস্ক্রাইব লিংক বসে, আর শুধু রাজি থাকা গ্রাহক পান */
  marketing: boolean;
  /** true হলে গ্রাহক তালিকায় না থাকলেও যায় (তবে আনসাবস্ক্রাইব করা কাউকে নয়) */
  allowNonSubscribers?: boolean;
  /** abandoned checkout: পাঠানোর আগে দেখা হয় অর্ডার হয়ে গেছে কিনা */
  checkoutId?: string;
  vars?: Record<string, string>;
} & ({ content: EmailContent } | { campaignId: string });

export interface SmsPayload {
  text: string;
}

export type MessageKind =
  "campaign" | "flow" | "back-in-stock" | "withdrawal" | "order-sms" | "otp" | "test";

/** আইনে বাধ্যতামূলক বা ক্রেতার নিজের চাওয়া বার্তা মাসের সীমায় আটকায় না */
const CAP_EXEMPT: MessageKind[] = ["withdrawal", "test"];
const MAX_ATTEMPTS = 4;

export const monthStart = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

interface QueueInput {
  kind: MessageKind;
  to: string;
  refId?: string;
  dedupeKey?: string;
  sendAt?: Date;
}

async function enqueue(
  shopId: string,
  channel: "email" | "sms",
  input: QueueInput,
  payload: unknown,
): Promise<boolean> {
  const { count } = await db.message.createMany({
    data: [
      {
        shopId,
        channel,
        kind: input.kind,
        refId: input.refId ?? null,
        recipient: input.to,
        dedupeKey: input.dedupeKey ?? null,
        payload: payload as Prisma.InputJsonValue,
        sendAt: input.sendAt ?? new Date(),
      },
    ],
    skipDuplicates: true,
  });
  return count > 0;
}

/** false ফেরত দিলে একই বার্তা আগেই লাইনে আছে (dedupeKey মিলে গেছে) */
export const enqueueEmail = (shopId: string, input: QueueInput & { payload: EmailPayload }) =>
  enqueue(shopId, "email", input, input.payload);

export const enqueueSms = (shopId: string, input: QueueInput & { text: string }) =>
  enqueue(shopId, "sms", input, { text: input.text } satisfies SmsPayload);

/** এ মাসে পাঠানো ইমেইল (সীমার হিসাবের জন্য) */
export function emailsSentThisMonth(shopId: string, now = new Date()) {
  return db.message.count({
    where: {
      shopId,
      channel: "email",
      sentAt: { gte: monthStart(now) },
      kind: { notIn: CAP_EXEMPT },
    },
  });
}

/* ------------------------------------------------------------------ */
/* পাঠানো                                                              */
/* ------------------------------------------------------------------ */

interface Claimed {
  id: string;
  shopId: string;
  channel: string;
  kind: string;
  refId: string | null;
  recipient: string;
  payload: unknown;
  attempts: number;
}

interface ShopState {
  id: string;
  domain: string;
  plan: string | null;
  uninstalledAt: Date | null;
  emailSettings: unknown;
  sentThisMonth: number;
  sms?: SmsConfig | null;
}

export interface Deps {
  send: (mail: OutgoingEmail) => Promise<SendResult>;
  sms: (config: SmsConfig, to: string, text: string) => Promise<SmsResult>;
  now: () => Date;
}

const defaultDeps: Deps = {
  send: (mail) => sendEmail(mail),
  sms: (config, to, text) => sendSms(config, to, text),
  now: () => new Date(),
};

type Outcome =
  | { status: "sent"; providerId?: string }
  | { status: "skipped" | "failed"; error: string }
  | { status: "retry"; error: string };

export function shopDisplayName(shop: { domain: string; emailSettings: unknown }): string {
  return (
    readEmailSettings(shop.emailSettings).senderName || shop.domain.replace(/\.myshopify\.com$/, "")
  );
}

async function emailOutcome(
  message: Claimed,
  shop: ShopState,
  campaigns: Map<string, EmailContent | null>,
  deps: Deps,
): Promise<Outcome> {
  const payload = message.payload as EmailPayload;
  const kind = message.kind as MessageKind;
  const cap =
    shop.plan === "professional" || shop.plan === "starter" ? EMAIL_MONTHLY_CAP[shop.plan] : 0;
  if (cap === 0) return { status: "skipped", error: "plan" };
  if (!CAP_EXEMPT.includes(kind) && shop.sentThisMonth >= cap) {
    return { status: "skipped", error: "monthly_limit" };
  }

  const subscriber = await db.subscriber.findUnique({
    where: { shopId_email: { shopId: shop.id, email: message.recipient } },
    select: { status: true },
  });
  if (subscriber?.status === "bounced" || subscriber?.status === "complained") {
    return { status: "skipped", error: "suppressed" };
  }
  if (payload.marketing) {
    if (subscriber?.status === "unsubscribed") return { status: "skipped", error: "unsubscribed" };
    if (!payload.allowNonSubscribers && subscriber?.status !== "subscribed") {
      return { status: "skipped", error: "not_subscribed" };
    }
  }
  if (payload.checkoutId) {
    const checkout = await db.abandonedCheckout.findUnique({
      where: { id: payload.checkoutId },
      select: { completedAt: true },
    });
    if (!checkout || checkout.completedAt) return { status: "skipped", error: "ordered" };
  }

  let content: EmailContent | null;
  if ("campaignId" in payload) {
    if (!campaigns.has(payload.campaignId)) {
      const row = await db.emailCampaign.findUnique({ where: { id: payload.campaignId } });
      const parsed = emailContentSchema.safeParse(row?.content);
      campaigns.set(payload.campaignId, parsed.success ? parsed.data : null);
    }
    content = campaigns.get(payload.campaignId) ?? null;
  } else {
    content = payload.content;
  }
  if (!content) return { status: "skipped", error: "no_content" };

  const settings = readEmailSettings(shop.emailSettings);
  const shopName = shopDisplayName(shop);
  const unsubscribe = payload.marketing ? unsubscribeUrl(shop.id, message.recipient) : undefined;
  const rendered = renderEmail(fillContent(content, { shop: shopName, ...payload.vars }), {
    shopName,
    accent: settings.accent,
    postalAddress: settings.postalAddress,
    unsubscribeUrl: unsubscribe,
    openPixelUrl: openPixelUrl(message.id),
    wrapLink: (url) => clickUrl(message.id, url),
  });
  const result = await deps.send({
    fromName: shopName,
    replyTo: settings.replyTo || undefined,
    to: message.recipient,
    ...rendered,
    // এক ক্লিকে আনসাবস্ক্রাইব (RFC 8058): Gmail ও Yahoo-র নিয়মে মার্কেটিং ইমেইলে লাগে
    headers: unsubscribe
      ? {
          "List-Unsubscribe": `<${unsubscribe}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
      : undefined,
  });
  if (result.ok) {
    if (!CAP_EXEMPT.includes(kind)) shop.sentThisMonth++;
    return { status: "sent", providerId: result.providerId };
  }
  const error = result.error ?? "send_failed";
  if (error === "email_not_configured") return { status: "skipped", error };
  return result.permanent ? { status: "failed", error } : { status: "retry", error };
}

async function smsOutcome(message: Claimed, shop: ShopState, deps: Deps): Promise<Outcome> {
  if (shop.sms === undefined) shop.sms = await smsGateway(shop.id);
  if (!shop.sms) return { status: "skipped", error: "sms_not_configured" };
  const result = await deps.sms(shop.sms, message.recipient, (message.payload as SmsPayload).text);
  if (result.ok) return { status: "sent", providerId: result.id };
  const error = result.error ?? "send_failed";
  return result.permanent ? { status: "failed", error } : { status: "retry", error };
}

async function claimMessages(limit: number): Promise<Claimed[]> {
  return db.$queryRaw<Claimed[]>`
    UPDATE "Message" SET status = 'sending', attempts = attempts + 1, "lockedAt" = now()
    WHERE id IN (
      SELECT id FROM "Message" WHERE status = 'queued' AND "sendAt" <= now()
      ORDER BY "sendAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "shopId", channel, kind, "refId", recipient, payload, attempts`;
}

/** লাইনে থাকা বার্তার একটা ব্যাচ পাঠায়; কয়টা নেওয়া হলো তা ফেরত দেয় */
export async function processMessages(
  limit = 20,
  deps: Deps = defaultDeps,
  claim: (limit: number) => Promise<Claimed[]> = claimMessages,
): Promise<number> {
  const batch = await claim(limit);
  const shops = new Map<string, ShopState | null>();
  const campaigns = new Map<string, EmailContent | null>();

  for (const message of batch) {
    let outcome: Outcome;
    try {
      if (!shops.has(message.shopId)) {
        const row = await db.shop.findUnique({
          where: { id: message.shopId },
          select: { id: true, domain: true, plan: true, uninstalledAt: true, emailSettings: true },
        });
        shops.set(
          message.shopId,
          row ? { ...row, sentThisMonth: await emailsSentThisMonth(row.id, deps.now()) } : null,
        );
      }
      const shop = shops.get(message.shopId);
      if (!shop || shop.uninstalledAt) outcome = { status: "skipped", error: "uninstalled" };
      else if (message.channel === "sms") outcome = await smsOutcome(message, shop, deps);
      else outcome = await emailOutcome(message, shop, campaigns, deps);
    } catch (error) {
      outcome = { status: "retry", error: error instanceof Error ? error.message : String(error) };
    }

    if (outcome.status === "retry" && message.attempts >= MAX_ATTEMPTS) {
      outcome = { status: "failed", error: outcome.error };
    }
    const now = deps.now();
    await db.message.update({
      where: { id: message.id },
      data:
        outcome.status === "sent"
          ? { status: "sent", sentAt: now, providerId: outcome.providerId ?? null, error: null }
          : outcome.status === "retry"
            ? {
                status: "queued",
                error: outcome.error.slice(0, 300),
                // ৫, ১০, ১৫ মিনিট পরে আবার
                sendAt: new Date(now.getTime() + message.attempts * 5 * 60_000),
              }
            : { status: outcome.status, error: outcome.error.slice(0, 300) },
    });
  }
  return batch.length;
}

/** সার্ভার বন্ধ হয়ে "sending"-এ আটকে থাকা বার্তা আবার লাইনে */
export async function recoverStuckMessages(now = new Date()) {
  await db.message.updateMany({
    where: { status: "sending", lockedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
    data: { status: "queued" },
  });
}

/* ------------------------------------------------------------------ */
/* রিপোর্ট                                                             */
/* ------------------------------------------------------------------ */

export interface DeliveryStats {
  /** প্রোভাইডার গ্রহণ করেছে (পৌঁছানো নিশ্চিত হওয়াগুলো সহ) */
  accepted: number;
  delivered: number;
  bounced: number;
  failed: number;
  skipped: number;
  queued: number;
  opened: number;
  clicked: number;
  /** গ্রহণ ÷ (গ্রহণ + ফেরত + ব্যর্থ), শতকরা; কিছু না পাঠালে null */
  rate: number | null;
}

export function deliveryRate(counts: Record<string, number>): DeliveryStats {
  const get = (key: string) => counts[key] ?? 0;
  const accepted = get("sent") + get("delivered");
  const bounced = get("bounced") + get("complained");
  const failed = get("failed");
  const attempted = accepted + bounced + failed;
  return {
    accepted,
    delivered: get("delivered"),
    bounced,
    failed,
    skipped: get("skipped"),
    queued: get("queued") + get("sending"),
    opened: get("opened"),
    clicked: get("clicked"),
    rate: attempted === 0 ? null : Math.round((accepted / attempted) * 1000) / 10,
  };
}

export async function messageStats(
  shopId: string,
  channel: "email" | "sms",
  options: { days?: number; kind?: string; refId?: string } = {},
): Promise<DeliveryStats> {
  const where = {
    shopId,
    channel,
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.refId ? { refId: options.refId } : {}),
    ...(options.days
      ? { createdAt: { gte: new Date(Date.now() - options.days * 86_400_000) } }
      : {}),
  };
  const [groups, opened, clicked] = await Promise.all([
    db.message.groupBy({ by: ["status"], where, _count: { _all: true } }),
    db.message.count({ where: { ...where, openedAt: { not: null } } }),
    db.message.count({ where: { ...where, clickedAt: { not: null } } }),
  ]);
  const counts: Record<string, number> = { opened, clicked };
  for (const g of groups) counts[g.status] = g._count._all;
  return deliveryRate(counts);
}

/** প্রোভাইডারের webhook থেকে: পৌঁছেছে, ফেরত এসেছে বা স্প্যাম অভিযোগ */
export async function applyDeliveryEvent(event: {
  type: "delivered" | "bounced" | "complained";
  providerId: string;
  recipients: string[];
}) {
  const message = await db.message.findFirst({
    where: { providerId: event.providerId, channel: "email" },
    select: { id: true, shopId: true, recipient: true },
  });
  if (!message) return false;
  if (event.type === "delivered") {
    // আগে bounce বা অভিযোগ এসে থাকলে দেরিতে আসা "delivered" সেটা বদলায় না
    await db.message.updateMany({
      where: { id: message.id, status: "sent" },
      data: { status: "delivered", deliveredAt: new Date() },
    });
    return true;
  }
  await db.message.update({ where: { id: message.id }, data: { status: event.type } });
  // এই ঠিকানায় আর কখনো পাঠানো হবে না
  await db.subscriber.upsert({
    where: { shopId_email: { shopId: message.shopId, email: message.recipient } },
    create: {
      shopId: message.shopId,
      email: message.recipient,
      status: event.type,
      source: "shopify",
      unsubscribedAt: new Date(),
    },
    update: { status: event.type, unsubscribedAt: new Date() },
  });
  if (event.type === "complained") {
    // স্প্যাম অভিযোগ মানে সম্মতি প্রত্যাহার: Shopify আর সংযুক্ত ইমেইল টুলেও বন্ধ করা হয়
    await enqueueJob(message.shopId, "shopify-consent", {
      email: message.recipient,
      state: "UNSUBSCRIBED",
    });
    await queueUnsubscribeSync(message.shopId, message.recipient);
  }
  return true;
}
