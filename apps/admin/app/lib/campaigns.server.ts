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
import { messageStats, shopDisplayName, type EmailPayload } from "./messages.server";
import { enqueueJob, registerJob } from "./queue.server";
import { cleanEmail, enabledSettings } from "./tool-state.server";

/**
 * একবারের ইমেইল ক্যাম্পেইন: খসড়া → (চাইলে সময় ঠিক করা) → পাঠানো।
 * পাঠানো মানে প্রতিটা গ্রাহকের জন্য `Message` লাইনে দেওয়া; আসল পাঠানো, সীমা আর
 * সম্মতি যাচাই হয় messages.server.ts-এ। বড় তালিকা ৫০০ জন করে ধাপে ধাপে লাইনে পড়ে।
 */
const SLICE = 500;

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

/** নতুন খসড়া বা আগের খসড়া সেভ; পাঠানো শুরু হয়ে গেলে আর বদলানো যায় না */
export async function saveCampaign(
  shopId: string,
  id: string | null,
  input: { name: string; content: unknown },
): Promise<string> {
  const content = emailContentSchema.parse(input.content) as Prisma.InputJsonValue;
  const name = input.name.trim().slice(0, 120) || "Untitled campaign";
  if (!id) {
    const created = await db.emailCampaign.create({ data: { shopId, name, content } });
    return created.id;
  }
  const { count } = await db.emailCampaign.updateMany({
    where: { id, shopId, status: { in: ["draft", "scheduled"] } },
    data: { name, content },
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
    data: { status: "sending", sentAt: now },
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
  const { count } = await db.message.createMany({
    data: batch.map((sub) => ({
      shopId,
      channel: "email",
      kind: "campaign",
      refId: campaignId,
      recipient: sub.email,
      // একই ক্যাম্পেইন একজনের কাছে একবারই যায়, ধাপটা আবার চললেও
      dedupeKey: `campaign:${campaignId}:${sub.id}`,
      payload: {
        campaignId,
        marketing: true,
        vars: { first_name: sub.firstName?.trim() || "there" },
      } satisfies EmailPayload as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
  return {
    queued: count,
    next: batch.length < SLICE ? null : (batch[batch.length - 1]?.id ?? null),
  };
}

registerJob("campaign-send", async (job) => {
  const {
    campaignId,
    cursor = "",
    queued = 0,
  } = job.payload as {
    campaignId: string;
    cursor?: string;
    queued?: number;
  };
  const campaign = await db.emailCampaign.findFirst({
    where: { id: campaignId, shopId: job.shopId, status: "sending" },
    select: { id: true },
  });
  if (!campaign) return;
  const slice = await queueCampaignSlice(job.shopId, campaignId, cursor);
  const total = queued + slice.queued;
  if (slice.next) {
    return {
      again: true,
      payload: { campaignId, cursor: slice.next, queued: total },
      progress: { queued: total },
    };
  }
  await db.emailCampaign.update({
    where: { id: campaignId },
    data: { status: "sent", recipients: total },
  });
  return { progress: { queued: total } };
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
