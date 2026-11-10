import type { Plan } from "@app/tool-sdk";

/** Shopify Billing-এ এই নামেই subscription তৈরি হয়। */
export const PLAN_KEYS = {
  STARTER_MONTHLY: "Starter Monthly",
  STARTER_ANNUAL: "Starter Annual",
  PRO_MONTHLY: "Professional Monthly",
  PRO_ANNUAL: "Professional Annual",
} as const;

export type PlanKey = (typeof PLAN_KEYS)[keyof typeof PLAN_KEYS];

export const TRIAL_DAYS = 7;

/** দাম এক জায়গায় (USD)। বার্ষিকে ২ মাস ফ্রি। চূড়ান্ত দাম ঠিক হলে শুধু এখানে বদলান। */
export const PRICES: Record<
  PlanKey,
  { tier: Plan; amount: number; interval: "monthly" | "annual" }
> = {
  [PLAN_KEYS.STARTER_MONTHLY]: { tier: "starter", amount: 7.99, interval: "monthly" },
  [PLAN_KEYS.STARTER_ANNUAL]: { tier: "starter", amount: 79.9, interval: "annual" },
  [PLAN_KEYS.PRO_MONTHLY]: { tier: "professional", amount: 14.99, interval: "monthly" },
  [PLAN_KEYS.PRO_ANNUAL]: { tier: "professional", amount: 149.9, interval: "annual" },
};

export const ALL_PLAN_KEYS = Object.keys(PRICES) as PlanKey[];

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && value in PRICES;
}

/** subscription-এর নাম থেকে প্ল্যান (starter/professional) */
export function tierFromSubscriptionName(name: string | null | undefined): Plan | null {
  return isPlanKey(name) ? PRICES[name].tier : null;
}

/**
 * মাসে সর্বোচ্চ কত ইমেইল (ইমেইল পাঠাতে আমাদের খরচ হয়, তাই সীমা; কোনো বাড়তি বিল নেই)।
 * ইমেইলের টুলগুলো শুধু Professional-এ, তাই Starter-এ ০। সংখ্যা বদলাতে হলে শুধু এখানে।
 */
export const EMAIL_MONTHLY_CAP: Record<Plan, number> = { starter: 0, professional: 10_000 };
