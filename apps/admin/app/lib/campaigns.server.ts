import { emailMarketing } from "@app/tools";
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import {
  emailContentSchema,
  fillContent,
  readEmailSettings,
  renderEmail,
  type EmailContent,
} from "./email-template";
import { sendEmail, type SendResult } from "./email-transport.server";
import { offlineAdmin } from "./admin-client.server";
import { messageStats, shopDisplayName, type EmailPayload } from "./messages.server";
import { MAX_ATTEMPTS, enqueueJob, registerJob } from "./queue.server";
import {
  membersPage,
  membersQueryDone,
  startMembersQuery,
  type SegmentMember,
  type SegmentOption,
} from "./segments.server";
import { cleanEmail, enabledSettings } from "./tool-state.server";

/**
 * একবারের ইমেইল ক্যাম্পেইন: খসড়া → (চাইলে সময় ঠিক করা) → পাঠানো।
 * পাঠানো মানে প্রতিটা গ্রাহকের জন্য `Message` লাইনে দেওয়া; আসল পাঠানো, সীমা আর
 * সম্মতি যাচাই হয় messages.server.ts-এ। বড় তালিকা ৫০০ জন করে ধাপে ধাপে লাইনে পড়ে।
 * Shopify-র কোনো customer segment বেছে নিলে শুধু সেই সেগমেন্টের subscribed গ্রাহকেরা পান
 * (সেগমেন্টের তালিকা Shopify থেকে ২৫০ জন করে আসে)।
 */
const SLICE = 500;
/** সেগমেন্টের তালিকা তৈরি হওয়ার জন্য কতক্ষণ পরপর দেখা, আর সর্বোচ্চ কতবার (৫ সেকেন্ড × ১২০ = ১০ মিনিট) */
const POLL_MS = 5_000;
const MAX_POLLS = 120;
/**
 * সেগমেন্টের এক পাতা (২৫০ জন) আনতে Shopify-র ~৫০০ পয়েন্ট লাগে, আর সাধারণ স্টোরে সেকেন্ডে ১০০ পয়েন্ট ফেরে;
 * তাই পাতার মাঝে ৫ সেকেন্ড বিরতি, যাতে বড় সেগমেন্টে Shopify থামিয়ে না দেয় (আর স্টোরের অন্য কাজও চলে)
 */
const PAGE_MS = 5_000;

export const DEFAULT_CAMPAIGN: EmailContent = {
  subject: "News from {shop}",
  preheader: "",
  heading: "Hello {first_name}",
  body: "Write your message here.",
  buttonText: "Visit the store",
  buttonUrl: "",
  imageUrl: "",
};

export function listCampaigns(shopId: string) {
  return db.emailCampaign.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export function getCampaign(shopId: string, id: string) {
  return db.emailCampaign.findFirst({ where: { id, shopId } });
}

export function readCampaignContent(raw: unknown): EmailContent {
  const parsed = emailContentSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_CAMPAIGN;
}

export class CampaignError extends Error {
  constructor(
    message: string,
    public code: "already_sent" | "tool_off" = "already_sent",
  ) {
    super(message);
  }
}

/** পাঠানো কেন থেমে গেছে (ক্যাম্পেইনের `error`) */
export type CampaignStop = "segment_missing" | "segment_timeout" | "send_failed";

/**
 * Email Marketing বন্ধ থাকলে (বা প্ল্যানে না থাকলে) ক্যাম্পেইন পাঠানো বা সময় ঠিক করা যায় না।
 * ক্যাম্পেইন একবারই পাঠানো যায়; বন্ধ অবস্থায় শুরু হলে তার সব ইমেইল বাদ পড়ত আর ক্যাম্পেইনটা নষ্ট হতো।
 */
async function requireMarketingOn(shopId: string) {
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: { id: true, plan: true },
  });
  if (!shop || !(await enabledSettings(shop, emailMarketing))) {
    throw new CampaignError("Email Marketing is turned off", "tool_off");
  }
}

/**
 * নতুন খসড়া বা আগের খসড়া সেভ; পাঠানো শুরু হয়ে গেলে আর বদলানো যায় না।
 * `segment`: null মানে সব সাবস্ক্রাইবার, না দিলে আগেরটাই থাকে। সেগমেন্টটা স্টোরে আছে কিনা
 * route আগেই Shopify-তে দেখে নেয়।
 */
export async function saveCampaign(
  shopId: string,
  id: string | null,
  input: { name: string; content: unknown; segment?: SegmentOption | null },
): Promise<string> {
  const content = emailContentSchema.parse(input.content) as Prisma.InputJsonValue;
  const name = input.name.trim().slice(0, 120) || "Untitled campaign";
  const audience =
    input.segment === undefined
      ? {}
      : {
          segmentId: input.segment?.id ?? null,
          segmentName: input.segment?.name.slice(0, 255) ?? null,
        };
  if (!id) {
    const created = await db.emailCampaign.create({
      data: { shopId, name, content, ...audience },
    });
    return created.id;
  }
  const { count } = await db.emailCampaign.updateMany({
    where: { id, shopId, status: { in: ["draft", "scheduled"] } },
    data: { name, content, ...audience, error: null },
  });
  if (count === 0) throw new CampaignError("This campaign was already sent");
  return id;
}

export async function deleteCampaign(shopId: string, id: string) {
  await db.emailCampaign.deleteMany({
    where: { id, shopId, status: { in: ["draft", "scheduled"] } },
  });
}

export async function scheduleCampaign(shopId: string, id: string, at: Date | null) {
  if (at) await requireMarketingOn(shopId);
  const { count } = await db.emailCampaign.updateMany({
    where: { id, shopId, status: { in: ["draft", "scheduled"] } },
    data: at ? { status: "scheduled", scheduledAt: at } : { status: "draft", scheduledAt: null },
  });
  if (count === 0) throw new CampaignError("This campaign was already sent");
}

/** পাঠানো শুরু করে। দুবার চাপলেও (বা দুটো সার্ভার একসাথে ধরলেও) একবারই শুরু হয় */
export async function startCampaign(shopId: string, id: string, now = new Date()) {
  await requireMarketingOn(shopId);
  const { count } = await db.emailCampaign.updateMany({
    where: { id, shopId, status: { in: ["draft", "scheduled"] } },
    data: { status: "sending", sentAt: now, error: null },
  });
  if (count === 0) return false;
  await enqueueJob(shopId, "campaign-send", { campaignId: id });
  return true;
}

/** সময় হয়ে যাওয়া ক্যাম্পেইনগুলো শুরু করে (প্রতি মিনিটে ডাকা হয়) */
export async function startDueCampaigns(now = new Date()) {
  const due = await db.emailCampaign.findMany({
    where: { status: "scheduled", scheduledAt: { lte: now } },
    select: { id: true, shopId: true },
    take: 50,
  });
  let started = 0;
  for (const campaign of due) {
    try {
      if (await startCampaign(campaign.shopId, campaign.id, now)) started++;
    } catch (error) {
      if (!(error instanceof CampaignError)) throw error;
      // সময় হওয়ার আগেই টুল বন্ধ করা হয়েছে: ক্যাম্পেইন খসড়ায় ফেরে, যাতে পরে টুল চালু করলে নিজে থেকে চলে না যায়
      await db.emailCampaign.updateMany({
        where: { id: campaign.id, status: "scheduled" },
        data: { status: "draft", scheduledAt: null },
      });
    }
  }
  return started;
}

type Recipient = { id: string; email: string; firstName: string | null };

/** গ্রাহকদের জন্য বার্তা লাইনে দেয়; একই ক্যাম্পেইন একজনের কাছে একবারই যায়, ধাপটা আবার চললেও */
async function queueMessages(shopId: string, campaignId: string, recipients: Recipient[]) {
  if (recipients.length === 0) return 0;
  const { count } = await db.message.createMany({
    data: recipients.map((sub) => ({
      shopId,
      channel: "email",
      kind: "campaign",
      refId: campaignId,
      recipient: sub.email,
      dedupeKey: `campaign:${campaignId}:${sub.id}`,
      payload: {
        campaignId,
        marketing: true,
        vars: { first_name: sub.firstName?.trim() || "there" },
      } satisfies EmailPayload as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
  return count;
}

/** এক ধাপ: পরের ৫০০ গ্রাহকের জন্য বার্তা লাইনে দেয় */
export async function queueCampaignSlice(
  shopId: string,
  campaignId: string,
  cursor: string,
): Promise<{ queued: number; next: string | null }> {
  const batch = await db.subscriber.findMany({
    where: { shopId, status: "subscribed", id: { gt: cursor } },
    orderBy: { id: "asc" },
    take: SLICE,
    select: { id: true, email: true, firstName: true },
  });
  if (batch.length === 0) return { queued: 0, next: null };
  return {
    queued: await queueMessages(shopId, campaignId, batch),
    next: batch.length < SLICE ? null : (batch[batch.length - 1]?.id ?? null),
  };
}

/**
 * সেগমেন্টের এক পাতা গ্রাহকের মধ্যে যাঁরা আমাদের তালিকায় subscribed, তাঁদের জন্য বার্তা লাইনে দেয়।
 * Shopify customer id দিয়ে মেলানো হয়, আর id জানা না থাকলে ইমেইল দিয়ে।
 */
export async function queueSegmentMembers(
  shopId: string,
  campaignId: string,
  members: SegmentMember[],
): Promise<number> {
  const ids = [...new Set(members.map((m) => m.customerId).filter(Boolean))];
  const emails = [...new Set(members.map((m) => m.email).filter((e): e is string => !!e))];
  const match: Prisma.SubscriberWhereInput[] = [];
  if (ids.length > 0) match.push({ customerId: { in: ids } });
  if (emails.length > 0) match.push({ email: { in: emails } });
  if (match.length === 0) return 0;
  const subscribers = await db.subscriber.findMany({
    where: { shopId, status: "subscribed", OR: match },
    orderBy: { id: "asc" },
    select: { id: true, email: true, firstName: true },
  });
  return queueMessages(shopId, campaignId, subscribers);
}

/**
 * পাঠানো থামানো। কিছুই লাইনে না পড়লে ক্যাম্পেইন খসড়ায় ফেরে (অন্য audience বেছে আবার পাঠানো যায়);
 * কিছু পড়ে থাকলে সেগুলো যায়, আর ক্যাম্পেইনটা "sent" হয় কারণ লেখা থাকে।
 */
export async function stopCampaign(campaignId: string, queued: number, reason: CampaignStop) {
  await db.emailCampaign.updateMany({
    where: { id: campaignId, status: "sending" },
    data:
      queued > 0
        ? { status: "sent", recipients: queued, error: reason }
        : { status: "draft", sentAt: null, scheduledAt: null, error: reason },
  });
}

type SendPayload = {
  campaignId: string;
  cursor?: string;
  queued?: number;
  /** সেগমেন্টের গ্রাহক তালিকার কাজ (Shopify-র CustomerSegmentMembersQuery) */
  queryId?: string;
  ready?: boolean;
  polls?: number;
};

/** সেগমেন্টের ক্যাম্পেইনের এক ধাপ: তালিকা চাওয়া → তৈরি হওয়ার অপেক্ষা → ২৫০ জন করে লাইনে দেওয়া */
async function segmentStep(
  shopId: string,
  segmentId: string,
  payload: SendPayload,
): Promise<
  { again: true; payload: SendPayload; delayMs?: number } | { done: number } | CampaignStop
> {
  const queued = payload.queued ?? 0;
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { domain: true } });
  if (!shop) return { done: queued };
  const admin = await offlineAdmin(shop.domain);
  if (!payload.queryId) {
    const query = await startMembersQuery(admin, segmentId);
    if (!query) return "segment_missing";
    return {
      again: true,
      payload: { ...payload, queryId: query.id, ready: query.done, polls: 0 },
      ...(query.done ? {} : { delayMs: POLL_MS }),
    };
  }
  if (!payload.ready) {
    if (await membersQueryDone(admin, payload.queryId)) {
      return { again: true, payload: { ...payload, ready: true } };
    }
    const polls = (payload.polls ?? 0) + 1;
    if (polls >= MAX_POLLS) return "segment_timeout";
    return { again: true, payload: { ...payload, polls }, delayMs: POLL_MS };
  }
  const page = await membersPage(admin, payload.queryId, payload.cursor || null);
  const total = queued + (await queueSegmentMembers(shopId, payload.campaignId, page.members));
  if (page.next) {
    return {
      again: true,
      payload: { ...payload, cursor: page.next, queued: total },
      delayMs: PAGE_MS,
    };
  }
  return { done: total };
}

registerJob("campaign-send", async (job) => {
  const payload = job.payload as SendPayload;
  const { campaignId, cursor = "", queued = 0 } = payload;
  const campaign = await db.emailCampaign.findFirst({
    where: { id: campaignId, shopId: job.shopId, status: "sending" },
    select: { id: true, segmentId: true },
  });
  if (!campaign) return;
  try {
    let total: number;
    if (campaign.segmentId) {
      const step = await segmentStep(job.shopId, campaign.segmentId, payload);
      if (typeof step === "string") {
        await stopCampaign(campaignId, queued, step);
        return { progress: { queued, stopped: step } };
      }
      if ("again" in step) {
        return { ...step, progress: { queued: step.payload.queued ?? queued } };
      }
      total = step.done;
    } else {
      const slice = await queueCampaignSlice(job.shopId, campaignId, cursor);
      total = queued + slice.queued;
      if (slice.next) {
        return {
          again: true,
          payload: { campaignId, cursor: slice.next, queued: total },
          progress: { queued: total },
        };
      }
    }
    await db.emailCampaign.update({
      where: { id: campaignId },
      data: { status: "sent", recipients: total },
    });
    return { progress: { queued: total } };
  } catch (error) {
    // শেষ চেষ্টাতেও ব্যর্থ: ক্যাম্পেইন "sending" অবস্থায় আটকে না থেকে থামে (কাজের ত্রুটি খাতায় যায়)
    if (job.attempts >= MAX_ATTEMPTS) await stopCampaign(campaignId, queued, "send_failed");
    throw error;
  }
});

export const campaignStats = (shopId: string, campaignId: string) =>
  messageStats(shopId, { kind: "campaign", refId: campaignId });

/**
 * পরীক্ষার ইমেইল: লাইনে না দিয়ে সরাসরি পাঠায়, যাতে মার্চেন্ট সাথে সাথে ফল (বা ত্রুটি) দেখেন।
 * আনসাবস্ক্রাইব লিংক বা গোনার লিংক থাকে না।
 */
export async function sendTestEmail(
  shop: { id: string; domain: string; emailSettings: unknown },
  rawContent: unknown,
  rawTo: unknown,
  buttonUrl?: string,
): Promise<SendResult> {
  const to = cleanEmail(rawTo);
  if (!to) return { ok: false, error: "Enter a valid email address", permanent: true };
  const parsed = emailContentSchema.safeParse(rawContent);
  if (!parsed.success) return { ok: false, error: "The email is not complete", permanent: true };
  const settings = readEmailSettings(shop.emailSettings);
  const shopName = shopDisplayName(shop);
  const content = { ...parsed.data, buttonUrl: buttonUrl ?? parsed.data.buttonUrl };
  const rendered = renderEmail(
    fillContent(content, { shop: shopName, first_name: "there", product: "your product" }),
    { shopName, accent: settings.accent, postalAddress: settings.postalAddress },
  );
  const result = await sendEmail({
    fromName: shopName,
    replyTo: settings.replyTo || undefined,
    to,
    ...rendered,
    subject: `[Test] ${rendered.subject}`,
  });
  // পরীক্ষার ইমেইলও হিসাবে থাকে (সীমায় গোনা হয় না)
  await db.message.create({
    data: {
      shopId: shop.id,
      channel: "email",
      kind: "test",
      recipient: to,
      payload: {},
      status: result.ok ? "sent" : "failed",
      error: result.ok ? null : (result.error ?? "send_failed").slice(0, 300),
      providerId: result.providerId ?? null,
      sentAt: result.ok ? new Date() : null,
      attempts: 1,
    },
  });
  return result;
}
