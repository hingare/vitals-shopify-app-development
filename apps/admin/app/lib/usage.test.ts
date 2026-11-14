import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { adjustUsage, monthKey, nextReset, readUsage, reserveUsage, usageLimit } =
  await import("./usage.server");

const pro = { id: "s1", plan: "professional", trialEndsAt: null };
const now = new Date("2026-11-20T10:00:00Z");

beforeEach(() => resetFakeDb());

describe("monthly usage meter", () => {
  it("names months in UTC and resets on the first of the next month", () => {
    expect(monthKey(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11");
    expect(monthKey(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12");
    expect(nextReset(new Date("2026-12-15T00:00:00Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("gives AI budget only to Professional, and a smaller one during the free trial", () => {
    expect(usageLimit({ id: "s", plan: "starter" }, "ai", now)).toBe(0);
    expect(usageLimit({ id: "s", plan: null }, "ai", now)).toBe(0);
    expect(usageLimit(pro, "ai", now)).toBe(3_000_000);
    const trial = { ...pro, trialEndsAt: new Date("2026-11-25T00:00:00Z") };
    expect(usageLimit(trial, "ai", now)).toBe(500_000);
    expect(usageLimit(trial, "ai", new Date("2026-11-26T00:00:00Z"))).toBe(3_000_000);
  });

  it("reserves within the limit and refuses anything that would pass it", async () => {
    expect((await reserveUsage(pro, "ai", 2_000_000, now)).ok).toBe(true);
    expect((await reserveUsage(pro, "ai", 1_000_000, now)).ok).toBe(true);
    expect((await reserveUsage(pro, "ai", 1, now)).ok).toBe(false);
    expect(db.usageCounter.rows).toHaveLength(1);
    expect(db.usageCounter.rows[0]).toMatchObject({ month: "2026-11", used: 3_000_000 });
  });

  it("never lets parallel reservations go over the limit together", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveUsage(pro, "ai", 700_000, now)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(db.usageCounter.rows[0]?.used).toBe(2_800_000);
  });

  it("settles a reservation to the real cost and frees the rest", async () => {
    const { month } = await reserveUsage(pro, "ai", 50_000, now);
    await adjustUsage(pro.id, "ai", month, 12_345 - 50_000);
    const usage = await readUsage(pro, "ai", now);
    expect(usage).toMatchObject({ used: 12_345, limit: 3_000_000, left: 2_987_655, trial: false });
  });

  it("starts a new month from zero", async () => {
    await reserveUsage(pro, "ai", 3_000_000, now);
    expect((await reserveUsage(pro, "ai", 1, new Date("2026-12-01T00:00:01Z"))).ok).toBe(true);
  });

  it("counts recordings against their own cap", async () => {
    expect((await reserveUsage(pro, "recordings", 1, now)).ok).toBe(true);
    expect((await reserveUsage({ ...pro, plan: "starter" }, "recordings", 1, now)).ok).toBe(false);
    expect((await readUsage(pro, "recordings", now)).limit).toBe(2_000);
  });
});
