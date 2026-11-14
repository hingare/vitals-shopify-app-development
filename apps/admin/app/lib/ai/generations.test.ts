import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../../db.server", async () => ({ default: (await import("../test-db")).fakeDb }));
vi.mock("../admin-client.server", () => ({ offlineAdmin: async () => ({ graphql: vi.fn() }) }));
const { fakeDb: db, resetFakeDb } = await import("../test-db");
const {
  applyGeneration,
  discardGeneration,
  registerAiTask,
  runGenerationJob,
  startGeneration,
  undoGeneration,
} = await import("./generations.server");
const { AiError } = await import("./errors");

const store: Record<string, string> = {};
let runs = 0;
let failWith: InstanceType<typeof AiError> | null = null;

// ai-descriptions নামেই নকল কাজ (প্ল্যানের নিয়ম আসল টুলের তালিকা থেকে আসে)
registerAiTask({
  toolId: "ai-descriptions",
  input: z.object({ productId: z.string() }),
  output: z.object({ text: z.string().min(1) }),
  async run({ input }) {
    runs++;
    if (failWith) throw failWith;
    return {
      output: { text: `Copy for ${input.productId}` },
      costMicros: 120,
      model: "test-model",
    };
  },
  async apply({ input, output }) {
    const previous = store[input.productId] ?? "";
    store[input.productId] = output.text;
    return { text: previous };
  },
  async undo({ input, previous }) {
    store[input.productId] = (previous as { text: string }).text;
  },
});

const pro = { id: "", domain: "a.myshopify.com", plan: "professional", trialEndsAt: null };
const admin = { graphql: vi.fn() };

const jobFor = (attempts = 1) => {
  const job = db.job.rows[db.job.rows.length - 1]!;
  return {
    id: job.id as string,
    shopId: job.shopId as string,
    kind: job.kind as string,
    payload: job.payload as Record<string, unknown>,
    attempts,
  };
};

beforeEach(() => {
  resetFakeDb();
  runs = 0;
  failWith = null;
  for (const key of Object.keys(store)) delete store[key];
  store.p1 = "Old copy";
  pro.id = db.shop.seed({ domain: pro.domain, plan: "professional", uninstalledAt: null })
    .id as string;
});

describe("AI generations", () => {
  it("queues the work on the AI lane and stores the result for review", async () => {
    const generation = await startGeneration(pro, "ai-descriptions", { productId: "p1" });
    expect(db.job.rows[0]?.kind).toBe(`ai:${generation.id}`);
    await runGenerationJob(jobFor());
    expect(db.aiGeneration.rows[0]).toMatchObject({
      status: "ready",
      output: { text: "Copy for p1" },
      costMicros: 120,
      model: "test-model",
    });
    // স্টোরে এখনো কিছু বসেনি
    expect(store.p1).toBe("Old copy");
  });

  it("refuses tools outside the store's plan and bad input", async () => {
    await expect(
      startGeneration({ ...pro, plan: "starter" }, "ai-descriptions", { productId: "p1" }),
    ).rejects.toMatchObject({ code: "plan" });
    await expect(startGeneration(pro, "ai-descriptions", { nope: 1 })).rejects.toMatchObject({
      code: "invalid",
    });
    expect(db.aiGeneration.rows).toHaveLength(0);
  });

  it("applies the merchant's edited version, then undoes it back to the old value", async () => {
    const generation = await startGeneration(pro, "ai-descriptions", { productId: "p1" });
    await runGenerationJob(jobFor());
    await applyGeneration(pro, admin, generation.id, { text: "Edited copy" });
    expect(store.p1).toBe("Edited copy");
    expect(db.aiGeneration.rows[0]).toMatchObject({
      status: "applied",
      output: { text: "Edited copy" },
      previous: { text: "Old copy" },
    });
    await undoGeneration(pro, admin, generation.id);
    expect(store.p1).toBe("Old copy");
    expect(db.aiGeneration.rows[0]?.status).toBe("undone");
  });

  it("never applies an edit that doesn't fit the expected shape, or applies twice", async () => {
    const generation = await startGeneration(pro, "ai-descriptions", { productId: "p1" });
    await runGenerationJob(jobFor());
    await expect(applyGeneration(pro, admin, generation.id, { text: "" })).rejects.toMatchObject({
      code: "invalid",
    });
    await applyGeneration(pro, admin, generation.id);
    await expect(applyGeneration(pro, admin, generation.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("keeps other stores' generations out of reach", async () => {
    const generation = await startGeneration(pro, "ai-descriptions", { productId: "p1" });
    await runGenerationJob(jobFor());
    const other = { ...pro, id: "someone-else" };
    await expect(applyGeneration(other, admin, generation.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(discardGeneration(other, generation.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("retries a busy provider through the job lane, then records the error kind", async () => {
    await startGeneration(pro, "ai-descriptions", { productId: "p1" });
    failWith = new AiError("busy", "overloaded");
    await expect(runGenerationJob(jobFor(1))).rejects.toThrow("busy");
    expect(db.aiGeneration.rows[0]?.status).toBe("queued");
    await runGenerationJob(jobFor(3));
    expect(db.aiGeneration.rows[0]).toMatchObject({ status: "failed", error: "busy" });
  });

  it("fails at once when the monthly budget is used up", async () => {
    await startGeneration(pro, "ai-descriptions", { productId: "p1" });
    failWith = new AiError("budget");
    await runGenerationJob(jobFor(1));
    expect(db.aiGeneration.rows[0]).toMatchObject({ status: "failed", error: "budget" });
    expect(runs).toBe(1);
  });

  it("does not run queued work after the store drops to Starter", async () => {
    await startGeneration(pro, "ai-descriptions", { productId: "p1" });
    db.shop.rows[0]!.plan = "starter";
    await runGenerationJob(jobFor());
    expect(runs).toBe(0);
    expect(db.aiGeneration.rows[0]).toMatchObject({ status: "failed", error: "plan" });
  });
});
