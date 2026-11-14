import { emailMarketing } from "@app/tools";
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { offlineAdmin } from "./admin-client.server";
import {
  emailContentSchema,
  fillContent,
  readEmailSettings,
  renderEmail,
  type EmailContent,
} from "./email-template";
import { sendEmail, type OutgoingEmail, type SendResult } from "./email-transport.server";
import { queueUnsubscribeSync } from "./integrations.server";
import { clickUrl, openPixelUrl, unsubscribeUrl } from "./links.server";
import { EMAIL_MONTHLY_CAP } from "./plans";
import { enqueueJob } from "./queue.server";
import { hasOptedOut } from "./shopify-customers.server";
import { enabledSettings } from "./tool-state.server";

/**
 * সব ইমেইল আগে `Message` টেবিলে লাইনে পড়ে, তারপর ব্যাকগ্রাউন্ডে যায়।
 * পাঠানোর ঠিক আগে প্রতিবার দেখা হয়: মাসের সীমা, টুল আর flow এখনো চালু কিনা, গ্রাহক এখনো রাজি কিনা,
 * ঠিকানা থেকে আগে bounce এসেছে কিনা। তাই লাইনে দেওয়ার পরে কেউ আনসাবস্ক্রাইব করলে, বা মার্চেন্ট টুল বন্ধ
 * করলে, আর কিছু যায় না।
 * তালিকায় নেই এমন কাউকে মার্কেটিং ইমেইল পাঠানোর আগে Shopify-কেও জিজ্ঞেস করা হয়, কারণ তিনি অ্যাপ বসানোর
 * আগে (বা অন্য অ্যাপ দিয়ে) আনসাবস্ক্রাইব করে থাকলে সেটা শুধু Shopify জানে।
 */
export type EmailPayload = {
  /** মার্কেটিং হলে আনসাবস্ক্রাইব লিংক বসে, আর শুধু রাজি থাকা গ্রাহক পান */
  marketing: boolean;
  /** true হলে গ্রাহক তালিকায় না থাকলেও যায় (তবে এখানে বা Shopify-তে আনসাবস্ক্রাইব করা কাউকে নয়) */
  allowNonSubscribers?: boolean;
  /** abandoned checkout: পাঠানোর আগে দেখা হয় অর্ডার হয়ে গেছে কিনা */
  checkoutId?: string;
  vars?: Record<string, string>;
} & ({ content: EmailContent } | { campaignId: string });

export type MessageKind = "campaign" | "flow" | "back-in-stock" | "withdrawal" | "chat" | "test";

/**
 * আইনে বাধ্যতামূলক বা ক্রেতার নিজের চাওয়া বার্তা মাসের সীমায় আটকায় না। Live Chat-এর ইমেইলও না: ক্রেতা নিজে
 * উত্তর চেয়েছেন, আর মার্চেন্টকে খবর দেওয়ার ইমেইলের নিজের দৈনিক সীমা আছে (chat.server.ts)।
 */
const CAP_EXEMPT: MessageKind[] = ["withdrawal", "chat", "test"];
/** কথোপকথনের ইমেইলে খোলা বা ক্লিক গোনার কিছু বসে না */
const UNTRACKED: MessageKind[] = ["withdrawal", "chat"];
/**
 * আইনে বাধ্যতামূলক প্রাপ্তিস্বীকার (EU withdrawal): ক্রেতা এইমাত্র নিজে এই ঠিকানা দিয়েছেন, তাই আগের
 * bounce বা স্প্যাম অভিযোগের কারণে আটকানো হয় না, আর এতে খোলা বা ক্লিক গোনার কিছু বসে না।
 */
const REQUIRED_NOTICE: MessageKind[] = ["withdrawal"];
const MAX_ATTEMPTS = 4;

export const monthStart = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

interface QueueInput {
  kind: MessageKind;
  to: string;
  refId?: string;
  dedupeKey?: string;
  sendAt?: Date;
  /**
   * একই বার্তা (dedupeKey) এখনো লাইনে থাকলে তার ঠিকানা আর লেখা এই নতুন তথ্যে বদলায়; পাঠানোর সময় বদলায় না।
   * যে ঘটনার তথ্য পাঠানোর আগে বদলাতে পারে তার জন্য (যেমন চেকআউটে শুধরে নেওয়া ইমেইল)।
   */
  refresh?: boolean;
}

/** false ফেরত দিলে একই বার্তা আগেই লাইনে আছে (dedupeKey মিলে গেছে) */
export async function enqueueEmail(
  shopId: string,
  input: QueueInput & { payload: EmailPayload },
): Promise<boolean> {
  const { count } = await db.message.createMany({
    data: [
      {
        shopId,
        channel: "email",
        kind: input.kind,
        refId: input.refId ?? null,
        recipient: input.to,
        dedupeKey: input.dedupeKey ?? null,
        payload: input.payload as Prisma.InputJsonValue,
        sendAt: input.sendAt ?? new Date(),
      },
    ],
    skipDuplicates: true,
  });
  if (count === 0 && input.refresh && input.dedupeKey) {
    await db.message.updateMany({
      where: { shopId, dedupeKey: input.dedupeKey, status: "queued" },
      data: { recipient: input.to, payload: input.payload as Prisma.InputJsonValue },
    });
  }
  return count > 0;
}

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
  /** Email Marketing চালু কিনা, আর কোন flow চালু (এই ব্যাচে প্রথমবার দরকার হলে জানা হয়) */
  marketingOn?: boolean;
  flows?: Map<string, boolean>;
}

export interface Deps {
  send: (mail: OutgoingEmail) => Promise<SendResult>;
  now: () => Date;
  /** এই ঠিকানার মালিক Shopify-তে মার্কেটিং ইমেইল বন্ধ করেছেন কিনা; Shopify উত্তর না দিলে ছোড়ে */
  optedOut: (shopDomain: string, email: string) => Promise<boolean>;
}

const defaultDeps: Deps = {
  send: (mail) => sendEmail(mail),
  now: () => new Date(),
  optedOut: async (shopDomain, email) => hasOptedOut(await offlineAdmin(shopDomain), email),
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

  // মার্চেন্ট Email Marketing বা flow-টা বন্ধ করলে আগে থেকে লাইনে থাকা ইমেইলও আর যায় না
  // (review request-এর মতো ইমেইল কয়েক দিন লাইনে থাকে)
  if (kind === "flow" || kind === "campaign") {
    shop.marketingOn ??= (await enabledSettings(shop, emailMarketing)) !== null;
    if (!shop.marketingOn) return { status: "skipped", error: "tool_off" };
  }
  if (kind === "flow") {
    const key = message.refId ?? "";
    shop.flows ??= new Map();
    if (!shop.flows.has(key)) {
      const flow = await db.emailFlow.findUnique({
        where: { shopId_key: { shopId: shop.id, key } },
        select: { enabled: true },
      });
      shop.flows.set(key, flow?.enabled === true);
    }
    if (!shop.flows.get(key)) return { status: "skipped", error: "flow_off" };
  }

  const subscriber = await db.subscriber.findUnique({
    where: { shopId_email: { shopId: shop.id, email: message.recipient } },
    select: { status: true },
  });
  const required = REQUIRED_NOTICE.includes(kind);
  if (!required && (subscriber?.status === "bounced" || subscriber?.status === "complained")) {
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
      select: { completedAt: true, email: true },
    });
    if (!checkout || checkout.completedAt) return { status: "skipped", error: "ordered" };
    // ক্রেতা এর মধ্যে চেকআউটে ঠিকানা বদলে থাকলে আগের ঠিকানায় যায় না
    if (checkout.email !== message.recipient) {
      return { status: "skipped", error: "address_changed" };
    }
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

  // তালিকায় নেই: Shopify-তে আনসাবস্ক্রাইব করা থাকলে যায় না, আর সেটা মনে রাখা হয় (পরের বার জিজ্ঞেস করতে হয় না)।
  // Shopify উত্তর না দিলে এখানেই ত্রুটি ওঠে আর বার্তাটা পরে আবার চেষ্টা হয়; না জেনে পাঠানো হয় না।
  // এটা Shopify-তে একটা অনুরোধ, তাই বাকি সব পরীক্ষার পরে (অর্ডার হয়ে যাওয়া চেকআউটের জন্য জিজ্ঞেসই করা হয় না)।
  if (payload.marketing && !subscriber && (await deps.optedOut(shop.domain, message.recipient))) {
    await db.subscriber.createMany({
      data: [
        {
          shopId: shop.id,
          email: message.recipient,
          status: "unsubscribed",
          unsubscribedAt: deps.now(),
        },
      ],
      skipDuplicates: true,
    });
    return { status: "skipped", error: "unsubscribed" };
  }

  const settings = readEmailSettings(shop.emailSettings);
  const shopName = shopDisplayName(shop);
  const unsubscribe = payload.marketing ? unsubscribeUrl(shop.id, message.recipient) : undefined;
  const rendered = renderEmail(fillContent(content, { shop: shopName, ...payload.vars }), {
    shopName,
    accent: settings.accent,
    postalAddress: settings.postalAddress,
    unsubscribeUrl: unsubscribe,
    openPixelUrl: UNTRACKED.includes(kind) ? undefined : openPixelUrl(message.id),
    wrapLink: UNTRACKED.includes(kind) ? undefined : (url) => clickUrl(message.id, url),
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
      else if (message.channel !== "email") outcome = { status: "skipped", error: "channel" };
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
  options: { days?: number; kind?: string; refId?: string } = {},
): Promise<DeliveryStats> {
  const where = {
    shopId,
    channel: "email",
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
