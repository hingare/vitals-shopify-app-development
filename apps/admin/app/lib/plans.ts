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

/**
 * AI-র মাসিক বাজেট, মাইক্রো-ডলারে (১০ লাখ = $১)। মার্চেন্ট দেখেন "ক্রেডিট": ১ ক্রেডিট = $০.০১ AI খরচ।
 * বাজেট শেষ হলে AI টুল মাসের বাকি দিন থামে; কোনো বাড়তি বিল হয় না। বদলাতে হলে শুধু এখানে।
 */
export const AI_MONTHLY_MICROS: Record<Plan, number> = { starter: 0, professional: 3_000_000 };
/** ফ্রি ট্রায়ালে AI বাজেট ছোট, যাতে বিল শুরুর আগেই পুরো মাসের খরচ না হয় */
export const AI_TRIAL_MICROS = 500_000;
export const MICROS_PER_CREDIT = 10_000;

/** মাসে কতগুলো ভিজিটর রেকর্ডিং রাখা যায় (সীমায় পৌঁছালে রেকর্ড থামে) */
export const RECORDINGS_MONTHLY_CAP: Record<Plan, number> = { starter: 0, professional: 2_000 };
/**
 * একটা রেকর্ডিংয়ের স্টোরেজ খরচ, ইচ্ছা করে বেশি ধরা (মাইক্রো-ডলারে): গড়ে ~১০০KB, ৩০ দিন রাখা,
 * কয়েকটা লেখা। R2-তে আসলে এর চেয়ে অনেক কম। plans.test.ts এটা দিয়ে খরচের সীমা মেলায়।
 */
export const RECORDING_COST_MICROS = 100;

/** Stage 6-এর শর্ত: Professional স্টোর প্রতি AI আর স্টোরেজের খরচ প্ল্যানের দামের এই অংশের নিচে */
export const COST_CEILING_SHARE = 0.3;
