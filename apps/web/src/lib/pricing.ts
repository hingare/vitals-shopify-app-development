import {
  AI_MONTHLY_MICROS,
  AI_TRIAL_MICROS,
  EMAIL_MONTHLY_CAP,
  MICROS_PER_CREDIT,
  PLAN_KEYS,
  PRICES,
  RECORDINGS_MONTHLY_CAP,
  TRIAL_DAYS,
  type Plan,
} from "@app/tool-sdk";
import { brand } from "@app/brand";
import { planCounts } from "./catalog";

/** Prices and limits exactly as the app bills them (one source: @app/tool-sdk). */
export interface PlanFacts {
  id: Plan;
  monthly: number;
  annual: number;
  /** What a year costs when paid monthly, minus the annual price */
  annualSaving: number;
  tools: number;
  aiCredits: number;
  aiTrialCredits: number;
  emails: number;
  recordings: number;
}

export function planFacts(): PlanFacts[] {
  const counts = planCounts();
  const plans: Array<[Plan, number, number]> = [
    ["starter", PRICES[PLAN_KEYS.STARTER_MONTHLY].amount, PRICES[PLAN_KEYS.STARTER_ANNUAL].amount],
    ["professional", PRICES[PLAN_KEYS.PRO_MONTHLY].amount, PRICES[PLAN_KEYS.PRO_ANNUAL].amount],
  ];
  return plans.map(([id, monthly, annual]) => ({
    id,
    monthly,
    annual,
    annualSaving: Math.round((monthly * 12 - annual) * 100) / 100,
    tools: counts[id],
    aiCredits: AI_MONTHLY_MICROS[id] / MICROS_PER_CREDIT,
    aiTrialCredits: id === "professional" ? AI_TRIAL_MICROS / MICROS_PER_CREDIT : 0,
    emails: EMAIL_MONTHLY_CAP[id],
    recordings: RECORDINGS_MONTHLY_CAP[id],
  }));
}

export const trialDays = TRIAL_DAYS;

/** "$7.99" style, always in US dollars because that is what Shopify bills */
export function usd(amount: number, locale = "en"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function lowestMonthly(): number {
  return Math.min(...planFacts().map((plan) => plan.monthly));
}

/**
 * Plan facts by name, for `{name}` placeholders in help and blog text. Written out in the
 * visitor's number format, so the text never repeats a price or a limit by hand.
 */
export function factValues(locale: string): Record<string, string> {
  const plans = planFacts();
  const starter = plans.find((plan) => plan.id === "starter")!;
  const pro = plans.find((plan) => plan.id === "professional")!;
  const num = new Intl.NumberFormat(locale);
  return {
    brand: brand.name,
    starterPrice: usd(starter.monthly, locale),
    starterAnnual: usd(starter.annual, locale),
    proPrice: usd(pro.monthly, locale),
    proAnnual: usd(pro.annual, locale),
    starterTools: num.format(starter.tools),
    proTools: num.format(pro.tools),
    trialDays: num.format(trialDays),
    aiCredits: num.format(pro.aiCredits),
    aiTrialCredits: num.format(pro.aiTrialCredits),
    emails: num.format(pro.emails),
    recordings: num.format(pro.recordings),
  };
}
