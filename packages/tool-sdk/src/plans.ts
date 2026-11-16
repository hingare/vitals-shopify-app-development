import type { Plan } from "./index";

/**
 * প্ল্যানের তথ্য এক জায়গায়: অ্যাপ (বিলিং, সীমা) আর ওয়েবসাইট (Pricing পেজ, হেল্প আর্টিকেল) দুটোই এখান থেকে পড়ে।
 * দাম বা সীমা বদলাতে হলে শুধু এই ফাইল বদলান।
 */

/** Shopify Billing-এ এই নামেই subscription তৈরি হয়। */
export const PLAN_KEYS = {
  STARTER_MONTHLY: "Starter Monthly",
  STARTER_ANNUAL: "Starter Annual",
  PRO_MONTHLY: "Professional Monthly",
  PRO_ANNUAL: "Professional Annual",
} as const;

export type PlanKey = (typeof PLAN_KEYS)[keyof typeof PLAN_KEYS];

export const TRIAL_DAYS = 7;

/** দাম (USD)। বার্ষিকে ২ মাস ফ্রি। */
export const PRICES: Record<
  PlanKey,
  { tier: Plan; amount: number; interval: "monthly" | "annual" }
> = {
  [PLAN_KEYS.STARTER_MONTHLY]: { tier: "starter", amount: 7.99, interval: "monthly" },
  [PLAN_KEYS.STARTER_ANNUAL]: { tier: "starter", amount: 79.9, interval: "annual" },
  [PLAN_KEYS.PRO_MONTHLY]: { tier: "professional", amount: 14.99, interval: "monthly" },
  [PLAN_KEYS.PRO_ANNUAL]: { tier: "professional", amount: 149.9, interval: "annual" },
};

/**
 * মাসে সর্বোচ্চ কত ইমেইল (ইমেইল পাঠাতে আমাদের খরচ হয়, তাই সীমা; কোনো বাড়তি বিল নেই)।
 * ইমেইলের টুলগুলো শুধু Professional-এ, তাই Starter-এ ০।
 */
export const EMAIL_MONTHLY_CAP: Record<Plan, number> = { starter: 0, professional: 10_000 };

/**
 * AI-র মাসিক বাজেট, মাইক্রো-ডলারে (১০ লাখ = $১)। মার্চেন্ট দেখেন "ক্রেডিট": ১ ক্রেডিট = $০.০১ AI খরচ।
 * বাজেট শেষ হলে AI টুল মাসের বাকি দিন থামে; কোনো বাড়তি বিল হয় না।
 */
export const AI_MONTHLY_MICROS: Record<Plan, number> = { starter: 0, professional: 3_000_000 };
/** ফ্রি ট্রায়ালে AI বাজেট ছোট, যাতে বিল শুরুর আগেই পুরো মাসের খরচ না হয় */
export const AI_TRIAL_MICROS = 500_000;
export const MICROS_PER_CREDIT = 10_000;

/** মাসে কতগুলো ভিজিটর রেকর্ডিং রাখা যায় (সীমায় পৌঁছালে রেকর্ড থামে) */
export const RECORDINGS_MONTHLY_CAP: Record<Plan, number> = { starter: 0, professional: 2_000 };
