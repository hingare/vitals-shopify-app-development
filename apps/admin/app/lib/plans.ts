import { PRICES, type Plan, type PlanKey } from "@app/tool-sdk";

// দাম, ট্রায়াল আর মাসিক সীমা @app/tool-sdk-এ থাকে, যাতে ওয়েবসাইটও একই সংখ্যা দেখায়।
export {
  AI_MONTHLY_MICROS,
  AI_TRIAL_MICROS,
  EMAIL_MONTHLY_CAP,
  MICROS_PER_CREDIT,
  PLAN_KEYS,
  PRICES,
  RECORDINGS_MONTHLY_CAP,
  TRIAL_DAYS,
  type PlanKey,
} from "@app/tool-sdk";

export const ALL_PLAN_KEYS = Object.keys(PRICES) as PlanKey[];

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && value in PRICES;
}

/** subscription-এর নাম থেকে প্ল্যান (starter/professional) */
export function tierFromSubscriptionName(name: string | null | undefined): Plan | null {
  return isPlanKey(name) ? PRICES[name].tier : null;
}

/**
 * একটা রেকর্ডিংয়ের সবচেয়ে বেশি সম্ভাব্য স্টোরেজ খরচ (মাইক্রো-ডলারে)। recordings.server.ts-এর সীমা ধরে R2-র দামে:
 * সর্বোচ্চ ৪MB × ৩০ দিন ($০.০১৫/GB-মাস) ≈ ৫৯, সর্বোচ্চ ৪টা লেখা ($৪.৫০/১০ লাখ) ≈ ১৮, কয়েকবার দেখা ≈ ৪;
 * মোট ≈ ৮১, তাই ১০০। গড় রেকর্ডিং (~১০০-৩০০KB, একটা লেখা) এর অনেক কম। plans.test.ts এটা দিয়ে খরচের সীমা মেলায়।
 */
export const RECORDING_COST_MICROS = 100;

/** Stage 6-এর শর্ত: Professional স্টোর প্রতি AI আর স্টোরেজের খরচ প্ল্যানের দামের এই অংশের নিচে */
export const COST_CEILING_SHARE = 0.3;
