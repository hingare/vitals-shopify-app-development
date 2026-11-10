import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { enqueueJob, latestJob, recoverStuckJobs, registerJob, runJob } =
  await import("./queue.server");

const context = (row: Record<string, unknown>, attempts = 1) => ({
  id: row.id as string,
  shopId: row.shopId as string,
  kind: row.kind as string,
  payload: row.payload as Record<string, unknown>,
  attempts,
});

beforeEach(() => resetFakeDb());

describe("background jobs", () => {
  it("marks a finished job done and keeps its progress", async () => {
    registerJob("ok", async () => ({ progress: { done: 3 } }));
    const job = await enqueueJob("s1", "ok", { a: 1 });
    await runJob(context(job));
    expect(db.job.rows[0]).toMatchObject({ status: "done", progress: { done: 3 }, error: null });
  });

  it("continues a long job step by step from where it stopped", async () => {
    registerJob("steps", async (job) => {
      const cursor = (job.payload.cursor as number | undefined) ?? 0;
      return cursor < 2
        ? { again: true, payload: { cursor: cursor + 1 }, progress: { cursor: cursor + 1 } }
        : { progress: { cursor } };
    });
    const job = await enqueueJob("s1", "steps");
    await runJob(context(job));
    expect(db.job.rows[0]).toMatchObject({
      status: "pending",
      payload: { cursor: 1 },
      attempts: 0,
    });
    await runJob(context(db.job.rows[0] as Record<string, unknown>));
    await runJob(context(db.job.rows[0] as Record<string, unknown>));
    expect(db.job.rows[0]).toMatchObject({ status: "done", progress: { cursor: 2 } });
  });

  it("retries a failing job with a delay, then marks it failed with the reason", async () => {
    registerJob("boom", async () => {
      throw new Error("Klaviyo is down");
    });
    const job = await enqueueJob("s1", "boom");
    await runJob(context(job, 1));
    expect(db.job.rows[0]).toMatchObject({ status: "pending", error: "Klaviyo is down" });
    expect((db.job.rows[0]?.runAt as Date).getTime()).toBeGreaterThan(Date.now() + 30_000);
    await runJob(context(job, 3));
    expect(db.job.rows[0]).toMatchObject({ status: "failed", error: "Klaviyo is down" });
  });

  it("fails clearly when nothing handles the job kind", async () => {
    const job = await enqueueJob("s1", "unknown-kind");
    await runJob(context(job, 3));
    expect(db.job.rows[0]?.error).toContain('No handler for job "unknown-kind"');
  });

  it("does not queue a second copy of a unique job that is still active", async () => {
    const first = await enqueueJob("s1", "import", {}, { unique: true });
    const second = await enqueueJob("s1", "import", {}, { unique: true });
    expect(second.id).toBe(first.id);
    await enqueueJob("s2", "import", {}, { unique: true });
    expect(db.job.rows).toHaveLength(2);
    expect((await latestJob("s1", "import"))?.id).toBe(first.id);
  });

  it("puts jobs stuck in 'running' back in the queue", async () => {
    db.job.seed({
      shopId: "s1",
      kind: "x",
      status: "running",
      startedAt: new Date(Date.now() - 11 * 60_000),
    });
    db.job.seed({ shopId: "s1", kind: "x", status: "running", startedAt: new Date() });
    await recoverStuckJobs();
    expect(db.job.rows.map((j) => j.status)).toEqual(["pending", "running"]);
  });
});
