import { pushNotifications } from "@app/tools";
import db from "../db.server";
import { decryptSecret, encryptSecret } from "./crypto.server";
import { pushClickUrl } from "./links.server";
import { enqueueJob, registerJob } from "./queue.server";
import { enabledSettings, type ShopRef } from "./tool-state.server";
import {
  generateVapidKeys,
  isPushEndpoint,
  sendPush,
  validPushKeys,
  type PushOutcome,
  type VapidKeys,
} from "./web-push.server";

/**
 * Push Notifications: ব্রাউজারের গ্রাহক রাখা আর নোটিফিকেশন পাঠানো।
 * প্রতিটা স্টোরের নিজের VAPID চাবি (private অংশ এনক্রিপ্ট করা)। আমরা ক্রেতার কোনো ব্যক্তিগত তথ্য রাখি না,
 * শুধু ব্রাউজারের দেওয়া ঠিকানা ও চাবি; ক্রেতা ব্রাউজারে অনুমতি তুলে নিলে ঠিকানাটা নিজে থেকেই মুছে যায়।
 */
type ShopRow = ShopRef & { domain: string };

const PAGE = 200;
const PARALLEL = 10;

/** স্টোরের VAPID চাবি; প্রথমবার চাওয়ার সময় তৈরি হয় */
export async function vapidKeys(shopId: string): Promise<VapidKeys> {
  const read = async () => {
    const row = await db.shop.findUnique({
      where: { id: shopId },
      select: { vapidPublicKey: true, vapidPrivateKey: true },
    });
    return row?.vapidPublicKey && row.vapidPrivateKey
      ? { publicKey: row.vapidPublicKey, privateKey: decryptSecret(row.vapidPrivateKey) }
      : null;
  };
  const existing = await read();
  if (existing) return existing;
  const fresh = generateVapidKeys();
  // একসাথে দুটো অনুরোধ এলে প্রথমটার চাবিই থাকে (চাবি বদলালে আগের সব গ্রাহক অচল হয়ে যেত)
  await db.shop.updateMany({
    where: { id: shopId, vapidPublicKey: null },
    data: { vapidPublicKey: fresh.publicKey, vapidPrivateKey: encryptSecret(fresh.privateKey) },
  });
  const saved = await read();
  if (!saved) throw new Error("Could not save push keys");
  return saved;
}

export type SubscribeOutcome = "saved" | "invalid" | "disabled";

export async function savePushSubscription(shop: ShopRow, raw: unknown): Promise<SubscribeOutcome> {
  if (!(await enabledSettings(shop, pushNotifications))) return "disabled";
  const input = (raw ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const p256dh = input.keys?.p256dh;
  const auth = input.keys?.auth;
  if (!isPushEndpoint(input.endpoint) || typeof p256dh !== "string" || typeof auth !== "string") {
    return "invalid";
  }
  if (p256dh.length > 200 || auth.length > 100 || !validPushKeys({ p256dh, auth })) {
    return "invalid";
  }
  await db.pushSubscription.upsert({
    where: { shopId_endpoint: { shopId: shop.id, endpoint: input.endpoint } },
    create: { shopId: shop.id, endpoint: input.endpoint, p256dh, auth },
    update: { p256dh, auth },
  });
  return "saved";
}

export const pushSubscriberCount = (shopId: string) =>
  db.pushSubscription.count({ where: { shopId } });

export function listPushCampaigns(shopId: string) {
  return db.pushCampaign.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
}

export class PushError extends Error {}

/** নোটিফিকেশন লাইনে দেয়; পাঠানো ব্যাকগ্রাউন্ডে ধাপে ধাপে হয় */
export async function createPushCampaign(
  shop: ShopRow,
  input: { title?: unknown; body?: unknown; url?: unknown },
): Promise<string> {
  if (!(await enabledSettings(shop, pushNotifications))) {
    throw new PushError("tool_off");
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
  if (!title || title.length > 80 || body.length > 200 || rawUrl.length > 500) {
    throw new PushError("invalid");
  }
  // ফাঁকা = স্টোরের হোম পেজ; "/collections/sale"-এর মতো পথ স্টোরের ঠিকানার সাথে জোড়া লাগে
  const base = `https://${shop.domain}`;
  const url = !rawUrl ? base : rawUrl.startsWith("/") ? `${base}${rawUrl}` : rawUrl;
  if (!/^https:\/\/\S+$/.test(url)) throw new PushError("invalid");
  const campaign = await db.pushCampaign.create({
    data: { shopId: shop.id, title, body, url },
  });
  await enqueueJob(shop.id, "push-send", { campaignId: campaign.id });
  return campaign.id;
}

type Sender = (
  target: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapid: VapidKeys & { subject: string },
) => Promise<PushOutcome>;

/** এক ধাপ: পরের ২০০ জন গ্রাহককে পাঠায়; আর বাকি থাকলে `next` ফেরত দেয় */
export async function sendPushSlice(
  campaignId: string,
  cursor: string,
  send: Sender = sendPush,
): Promise<{ next: string | null }> {
  const campaign = await db.pushCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status === "sent") return { next: null };
  const shop = await db.shop.findUnique({ where: { id: campaign.shopId } });
  const allowed =
    shop && !shop.uninstalledAt ? await enabledSettings(shop, pushNotifications) : null;
  if (!shop || !allowed) {
    await db.pushCampaign.update({ where: { id: campaignId }, data: { status: "sent" } });
    return { next: null };
  }
  if (campaign.status === "queued") {
    await db.pushCampaign.update({ where: { id: campaignId }, data: { status: "sending" } });
  }

  const batch = await db.pushSubscription.findMany({
    where: { shopId: shop.id, id: { gt: cursor } },
    orderBy: { id: "asc" },
    take: PAGE,
  });
  const vapid = { ...(await vapidKeys(shop.id)), subject: `https://${shop.domain}` };
  const payload = JSON.stringify({
    title: campaign.title,
    body: campaign.body,
    url: pushClickUrl(campaign.id, campaign.url),
    tag: campaign.id,
  });

  let sent = 0;
  let failed = 0;
  const gone: string[] = [];
  for (let i = 0; i < batch.length; i += PARALLEL) {
    const outcomes = await Promise.all(
      batch
        .slice(i, i + PARALLEL)
        .map((sub) => send(sub, payload, vapid).catch((): PushOutcome => "failed")),
    );
    outcomes.forEach((outcome, index) => {
      if (outcome === "sent") sent++;
      else failed++;
      if (outcome === "gone") gone.push(batch[i + index]!.id);
    });
  }
  if (gone.length > 0) await db.pushSubscription.deleteMany({ where: { id: { in: gone } } });

  const done = batch.length < PAGE;
  await db.pushCampaign.update({
    where: { id: campaignId },
    data: {
      sent: { increment: sent },
      failed: { increment: failed },
      ...(done ? { status: "sent" } : {}),
    },
  });
  return { next: done ? null : (batch[batch.length - 1]?.id ?? null) };
}

registerJob("push-send", async (job) => {
  const { campaignId, cursor = "" } = job.payload as { campaignId: string; cursor?: string };
  const { next } = await sendPushSlice(campaignId, cursor);
  if (next) return { again: true, payload: { campaignId, cursor: next } };
});
