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
  { admin, billing }: Pick<AdminContext, "admin" | "billing">,
  shopDomain: string,
): Promise<Plan | null> {
  const isTest = await isTestBilling(admin, shopDomain);
  const result = await billing.check({ plans: ALL_PLAN_KEYS, isTest });
  const active = result.appSubscriptions.find((s) => s.status === "ACTIVE");
  const plan = tierFromSubscriptionName(active?.name);
  await db.shop.update({
    where: { domain: shopDomain },
    data: { plan, subscriptionId: active?.id ?? null, trialEndsAt: trialEnd(active) },
  });
  return plan;
}

/** ফ্রি ট্রায়াল কবে শেষ (ট্রায়ালে AI ক্রেডিট কম থাকে, usage.server.ts দেখুন) */
export function trialEnd(
  subscription: { trialDays?: number; createdAt?: string } | undefined,
): Date | null {
  const days = subscription?.trialDays ?? 0;
  const created = subscription?.createdAt ? new Date(subscription.createdAt) : null;
  if (days <= 0 || !created || Number.isNaN(created.getTime())) return null;
  return new Date(created.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * টেস্ট বিল (টাকা কাটে না): লোকাল ডেভেলপমেন্টে, BILLING_TEST=true দিলে, আর Shopify-র ডেভেলপমেন্ট
 * স্টোরে। ডেভেলপমেন্ট স্টোরে আসল বিল হয় না, তাই সেখানে টেস্ট বিল না চাইলে App Store রিভিউয়ার বা
 * অন্য ডেভেলপার প্ল্যানই নিতে পারতেন না (App Store-এর শর্ত ১.২.২)।
 */
export async function isTestBilling(admin: AdminContext["admin"], shopDomain: string) {
  if (process.env.NODE_ENV !== "production" || process.env.BILLING_TEST === "true") return true;
  return isDevelopmentStore(admin, shopDomain);
}

const DEV_STORE_TTL_MS = 10 * 60_000;
const devStores = new Map<string, { value: boolean; at: number }>();

/**
 * Shopify-র ডেভেলপমেন্ট স্টোর কিনা (shop.plan.partnerDevelopment), ১০ মিনিট মনে রেখে।
 * জানা না গেলে false, মানে আসল বিল: ভুল করে কোনো আসল দোকান বিনা পয়সায় প্ল্যান পায় না।
 */
export async function isDevelopmentStore(
  admin: AdminContext["admin"],
  shopDomain: string,
  now = Date.now(),
): Promise<boolean> {
  const cached = devStores.get(shopDomain);
  if (cached && now - cached.at < DEV_STORE_TTL_MS) return cached.value;
  const value = await admin
    .graphql(
      `#graphql
      query DevelopmentStore { shop { plan { partnerDevelopment } } }`,
    )
    .then(
      (r) => r.json() as Promise<{ data?: { shop?: { plan?: { partnerDevelopment?: boolean } } } }>,
    )
    .then((j) => j.data?.shop?.plan?.partnerDevelopment)
    .catch(() => undefined);
  if (typeof value !== "boolean") return false;
  if (devStores.size > 10_000) devStores.clear();
  devStores.set(shopDomain, { value, at: now });
  return value;
}

export function planOf(shop: { plan: string | null }): Plan | null {
  return shop.plan === "starter" || shop.plan === "professional" ? shop.plan : null;
}
