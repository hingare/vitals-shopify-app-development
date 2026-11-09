import type { Plan } from "@app/tool-sdk";
import db from "../db.server";
import { ALL_PLAN_KEYS, tierFromSubscriptionName } from "./plans";
import { authenticate } from "../shopify.server";

type AdminContext = Awaited<ReturnType<typeof authenticate.admin>>;

/** স্টোরের রেকর্ড আনে, না থাকলে তৈরি করে; আবার ইনস্টল করলে uninstalledAt মুছে দেয়। */
export async function ensureShop(domain: string) {
  return db.shop.upsert({
    where: { domain },
    create: { domain },
    update: { uninstalledAt: null },
  });
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
