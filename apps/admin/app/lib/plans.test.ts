import { describe, expect, it } from "vitest";
import {
  AI_MONTHLY_MICROS,
  AI_TRIAL_MICROS,
  COST_CEILING_SHARE,
  PRICES,
  RECORDING_COST_MICROS,
  RECORDINGS_MONTHLY_CAP,
} from "./plans";

/** মাসে সবচেয়ে কম যা আসে (বার্ষিক প্ল্যানে মাসের ভাগ কম) */
function lowestMonthlyRevenue(tier: "starter" | "professional") {
  return Math.min(
    ...Object.values(PRICES)
      .filter((p) => p.tier === tier)
      .map((p) => (p.interval === "annual" ? p.amount / 12 : p.amount)),
  );
}

describe("plan costs", () => {
  it("keeps the most a Professional store can cost in AI and storage under the ceiling", () => {
    const worstMonth =
      (AI_MONTHLY_MICROS.professional +
        RECORDINGS_MONTHLY_CAP.professional * RECORDING_COST_MICROS) /
      1_000_000;
    expect(worstMonth).toBeLessThan(lowestMonthlyRevenue("professional") * COST_CEILING_SHARE);
  });

  it("gives Starter no AI or recording budget, since those tools are Professional", () => {
    expect(AI_MONTHLY_MICROS.starter).toBe(0);
    expect(RECORDINGS_MONTHLY_CAP.starter).toBe(0);
  });

  it("keeps the trial budget below a full month", () => {
    expect(AI_TRIAL_MICROS).toBeLessThan(AI_MONTHLY_MICROS.professional);
  });
});
