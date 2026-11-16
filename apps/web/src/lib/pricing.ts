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
