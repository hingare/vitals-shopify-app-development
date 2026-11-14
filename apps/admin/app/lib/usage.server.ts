import db from "../db.server";
import { AI_MONTHLY_MICROS, AI_TRIAL_MICROS, RECORDINGS_MONTHLY_CAP } from "./plans";

/**
 * মাসিক খরচের মিটার। AI-র খরচ মাইক্রো-ডলারে, রেকর্ডিং সংখ্যায়।
 * কাজের আগে সর্বোচ্চ সম্ভাব্য খরচ ধরে রাখা হয় (reserve), কাজের পরে আসল খরচে মেলানো হয় (adjust)।
 * ধরে রাখা যায় শুধু সীমার ভেতরে থাকলে, তাই সীমা পেরোলে কাজ নিজে থেকেই থামে, আর বাড়তি বিল কখনো হয় না।
 */
export type Meter = "ai" | "recordings";

export interface UsageShop {
  id: string;
  plan: string | null;
  trialEndsAt?: Date | null;
}

/** মাসের নাম (UTC), যেমন "2026-11"। নতুন মাসে হিসাব নিজে থেকেই শূন্য থেকে শুরু হয়। */
export const monthKey = (now = new Date()) => now.toISOString().slice(0, 7);

/** পরের মাসের প্রথম দিন (UTC), যখন সীমা আবার ভরে */
export const nextReset = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

export function usageLimit(shop: UsageShop, meter: Meter, now = new Date()): number {
  const plan = shop.plan === "starter" || shop.plan === "professional" ? shop.plan : null;
  if (!plan) return 0;
  if (meter === "recordings") return RECORDINGS_MONTHLY_CAP[plan];
  const full = AI_MONTHLY_MICROS[plan];
  return shop.trialEndsAt && shop.trialEndsAt > now ? Math.min(full, AI_TRIAL_MICROS) : full;
}

/**
 * সীমার ভেতরে থাকলে `amount` ধরে রাখে আর ok: true দেয়; না থাকলে কিছুই বদলায় না।
 * শর্তসহ একটাই UPDATE, তাই একসাথে অনেক অনুরোধ এলেও সীমা পেরোয় না।
 */
export async function reserveUsage(
  shop: UsageShop,
  meter: Meter,
  amount: number,
  now = new Date(),
): Promise<{ ok: boolean; month: string }> {
  const month = monthKey(now);
  const limit = usageLimit(shop, meter, now);
  if (amount <= 0 || amount > limit) return { ok: amount <= 0, month };
  const key = { shopId: shop.id, meter, month };
  await db.usageCounter.upsert({
    where: { shopId_meter_month: key },
    create: key,
    update: {},
  });
  const { count } = await db.usageCounter.updateMany({
    where: { ...key, used: { lte: limit - amount } },
    data: { used: { increment: amount } },
  });
  return { ok: count > 0, month };
}

/** ধরে রাখা পরিমাণ আসল খরচে মেলায়: বেশি ধরা থাকলে ফেরত (ঋণাত্মক), কম হলে যোগ। মাস reserve-এর মাসই। */
export async function adjustUsage(shopId: string, meter: Meter, month: string, delta: number) {
  if (delta === 0) return;
  await db.usageCounter.updateMany({
    where: { shopId, meter, month },
    data: { used: { increment: delta } },
  });
}

export async function readUsage(shop: UsageShop, meter: Meter, now = new Date()) {
  const month = monthKey(now);
  const row = await db.usageCounter.findUnique({
    where: { shopId_meter_month: { shopId: shop.id, meter, month } },
  });
  const limit = usageLimit(shop, meter, now);
  const used = Math.max(0, row?.used ?? 0);
  return {
    month,
    used,
    limit,
    left: Math.max(0, limit - used),
    trial: Boolean(shop.trialEndsAt && shop.trialEndsAt > now && meter === "ai"),
    resetsAt: nextReset(now),
  };
}
