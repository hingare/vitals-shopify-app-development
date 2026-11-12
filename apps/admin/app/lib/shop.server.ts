import type { Plan } from "@app/tool-sdk";
import db from "../db.server";
import { ALL_PLAN_KEYS, tierFromSubscriptionName } from "./plans";
import { forgetStaleSubscribers, queueReimport } from "./subscribers.server";
import type { authenticate } from "../shopify.server";

type AdminContext = Awaited<ReturnType<typeof authenticate.admin>>;

/**
 * স্টোরের রেকর্ড আনে, না থাকলে তৈরি করে।
 * আবার ইনস্টল হলে (আনইনস্টলের ৪৮ ঘণ্টার মধ্যে, তথ্য মোছার আগে) `uninstalledAt` তোলার আগে গ্রাহক তালিকার
 * পুরনো "রাজি" সারিগুলো মোছা হয়, তারপর Shopify থেকে নতুন করে আনার কাজ লাইনে পড়ে (subscribers.server.ts)।
 * ক্রমটা ইচ্ছাকৃত: মাঝপথে সার্ভার থামলে পরের অনুরোধ আবার মোছে; আনার কাজটা হারালে তালিকা খালি থাকে, ভুল থাকে না।
 */
export async function ensureShop(domain: string) {
  const existing = await db.shop.findUnique({ where: { domain } });
  if (!existing) {
    // প্রথম ইনস্টলে একসাথে কয়েকটা অনুরোধ আসে (পেজের একাধিক loader): যে আগে পৌঁছায় সে বানায়, বাকিরা সেটাই পায়
    await db.shop.createMany({ data: [{ domain }], skipDuplicates: true });
    return db.shop.findUniqueOrThrow({ where: { domain } });
  }
  if (!existing.uninstalledAt) return existing;
  await forgetStaleSubscribers(existing.id);
  // একসাথে আসা অনুরোধগুলোর মধ্যে যেটা চিহ্নটা তোলে, শুধু সেটাই আনার কাজ লাইনে দেয়
  const { count } = await db.shop.updateMany({
    where: { id: existing.id, uninstalledAt: { not: null } },
    data: { uninstalledAt: null },
  });
  if (count > 0) {
    await queueReimport(existing.id).catch((error: unknown) =>
      console.warn("[subscribers] could not queue the import after reinstall", error),
    );
  }
  return { ...existing, uninstalledAt: null };
}

/**
 * Shopify Billing থেকে আসল প্ল্যান মিলিয়ে ডাটাবেসে রাখে।
 * webhook মিস হলেও ড্যাশবোর্ড বা প্ল্যান পেজ খুললেই ঠিক হয়ে যায়।
 */
export async function syncPlanFromBilling(
  billing: AdminContext["billing"],
  shopDomain: string,
): Promise<Plan | null> {
  const result = await billing.check({ plans: ALL_PLAN_KEYS, isTest: isTestBilling() });
  const active = result.appSubscriptions.find((s) => s.status === "ACTIVE");
  const plan = tierFromSubscriptionName(active?.name);
  await db.shop.update({
    where: { domain: shopDomain },
    data: { plan, subscriptionId: active?.id ?? null },
  });
  return plan;
}

/** ডেভেলপমেন্ট স্টোরে সব বিল টেস্ট মোডে হয় */
export function isTestBilling() {
  return process.env.NODE_ENV !== "production" || process.env.BILLING_TEST === "true";
}

export function planOf(shop: { plan: string | null }): Plan | null {
  return shop.plan === "starter" || shop.plan === "professional" ? shop.plan : null;
}
