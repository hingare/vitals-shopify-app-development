import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
const snapshotCreate = vi.fn();
const errorUpsert = vi.fn();
vi.mock("../db.server", () => ({
  default: {
    speedJob: { update: (...a: unknown[]) => update(...a) },
    toolSetting: { count: async () => 0 },
    speedSnapshot: { count: async () => 0, create: (...a: unknown[]) => snapshotCreate(...a) },
    shop: { findUnique: async () => ({ domain: "speedy.myshopify.com" }) },
    appError: {
      updateMany: async () => ({ count: 0 }),
      upsert: (...a: unknown[]) => errorUpsert(...a),
    },
  },
}));

const { runSpeedJob } = await import("./jobs.server");
const job = { id: "j1", shopId: "s1", url: "https://shop.com", attempts: 1 };

describe("runSpeedJob", () => {
  beforeEach(() => {
    update.mockReset();
    snapshotCreate.mockReset();
    errorUpsert.mockReset();
  });

  it("saves the score and marks the job done", async () => {
    await runSpeedJob(job, async () => ({ score: 91, lcpMs: 1200, cls: 0.01, tbtMs: 50 }));
    expect(snapshotCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ shopId: "s1", score: 91, kind: "baseline" }),
    });
    expect(update.mock.calls[0][0].data.status).toBe("done");
  });

  it("retries once, then gives up", async () => {
    const fail = async () => {
      throw new Error("PSI down");
    };
    await runSpeedJob(job, fail);
    expect(update.mock.calls[0][0].data).toMatchObject({ status: "pending", error: "PSI down" });
    expect(errorUpsert).not.toHaveBeenCalled();
    await runSpeedJob({ ...job, attempts: 2 }, fail);
    expect(update.mock.calls[1][0].data).toMatchObject({ status: "failed", error: "PSI down" });
    // শেষ চেষ্টাও ব্যর্থ হলে অ্যাপের ত্রুটির খাতায়
    expect(errorUpsert.mock.calls[0][0].create).toMatchObject({
      source: "job",
      location: "speed-check",
      message: "PSI down",
      lastShop: "speedy.myshopify.com",
    });
  });
});
