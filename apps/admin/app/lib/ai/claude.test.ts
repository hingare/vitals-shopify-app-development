import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../../db.server", async () => ({ default: (await import("../test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("../test-db");
const { generate, modelFor, setAiClientForTests } = await import("./claude.server");
const { AiError } = await import("./errors");
const { usageCostMicros } = await import("./pricing");

const shop = { id: "s1", plan: "professional", trialEndsAt: null };
const schema = z.object({ title: z.string() });

function message(overrides: Partial<BetaMessage> = {}): BetaMessage {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: '{"title":"Linen shirt"}', citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1_000, output_tokens: 400, iterations: null },
    ...overrides,
  } as unknown as BetaMessage;
}

let sent: BetaMessageStreamParams[] = [];

function answerWith(result: BetaMessage | Error) {
  setAiClientForTests({
    beta: {
      messages: {
        stream(params) {
          sent.push(params);
          return {
            finalMessage: () =>
              result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
          };
        },
      },
    },
  });
}

const request = (tier: "fast" | "smart" = "fast") => ({
  shop,
  tier,
  system: "Write a product title.",
  content: [{ type: "text" as const, text: "A white linen shirt" }],
  schema,
  maxTokens: 2_000,
});

const used = () => (db.usageCounter.rows[0]?.used as number | undefined) ?? 0;

beforeEach(() => {
  resetFakeDb();
  sent = [];
  delete process.env.AI_MODEL;
  delete process.env.AI_FAST_MODEL;
});
afterEach(() => setAiClientForTests(null));

describe("generate", () => {
  it("returns the parsed answer and charges the store only the real cost", async () => {
    answerWith(message());
    const result = await generate(request());
    expect(result.data).toEqual({ title: "Linen shirt" });
    // Haiku 5.5: 1000 × $0.10 + 400 × $0.50 = 300 মাইক্রো-ডলার
    expect(result.costMicros).toBe(300);
    expect(used()).toBe(300);
    expect(sent[0]?.output_config?.format).toMatchObject({ type: "json_schema" });
    // Haiku-র server-side fallback নেই, তাই পাঠানো হয় না
    expect(sent[0]).not.toHaveProperty("fallbacks");
  });

  it("asks Opus for a fallback when it declines, and prices each attempt at its own model", async () => {
    answerWith(
      message({
        model: "claude-opus-5",
        usage: {
          input_tokens: 1_000,
          output_tokens: 500,
          iterations: [
            { type: "message", model: "claude-opus-5-5", input_tokens: 1_000, output_tokens: 100 },
            {
              type: "fallback_message",
              model: "claude-opus-5",
              input_tokens: 1_000,
              output_tokens: 500,
            },
          ],
        },
      } as unknown as Partial<BetaMessage>),
    );
    const result = await generate(request("smart"));
    expect(sent[0]).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
    });
    // (1000×4 + 100×20) + (1000×5 + 500×25) = 6000 + 17500
    expect(result.costMicros).toBe(23_500);
    expect(result.model).toBe("claude-opus-5");
    expect(used()).toBe(23_500);
  });

  it("does not call Claude when the month's budget can't cover the request", async () => {
    answerWith(message());
    db.usageCounter.seed({
      shopId: "s1",
      meter: "ai",
      month: new Date().toISOString().slice(0, 7),
      used: 2_999_990,
    });
    await expect(generate(request())).rejects.toMatchObject({ code: "budget" });
    expect(sent).toHaveLength(0);
    expect(used()).toBe(2_999_990);
  });

  it("gives Starter stores no AI at all", async () => {
    answerWith(message());
    await expect(
      generate({ ...request(), shop: { ...shop, plan: "starter" } }),
    ).rejects.toMatchObject({
      code: "budget",
    });
    expect(sent).toHaveLength(0);
  });

  it("reports a refusal and still counts what the attempt cost", async () => {
    answerWith(message({ stop_reason: "refusal", content: [] }));
    await expect(generate(request())).rejects.toMatchObject({ code: "refused" });
    expect(used()).toBe(300);
  });

  it("reports an answer cut off by the token limit", async () => {
    answerWith(message({ stop_reason: "max_tokens" }));
    await expect(generate(request())).rejects.toMatchObject({ code: "too_long" });
  });

  it("reports an answer that does not match the expected shape", async () => {
    answerWith(message({ content: [{ type: "text", text: '{"name":1}', citations: null }] }));
    await expect(generate(request())).rejects.toMatchObject({ code: "invalid" });
    expect(used()).toBe(300);
  });

  it("frees the whole reservation when the request never reached Claude", async () => {
    answerWith(new Anthropic.APIConnectionError({ message: "socket hang up" }));
    const error = await generate(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: "busy", retryable: true });
    expect(used()).toBe(0);
  });

  it("says AI is not set up when there is no API key or the model has no price", async () => {
    setAiClientForTests(null);
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(generate(request())).rejects.toMatchObject({ code: "not_configured" });
    if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;

    answerWith(message());
    process.env.AI_FAST_MODEL = "claude-unknown-1";
    await expect(generate(request())).rejects.toMatchObject({ code: "not_configured" });
  });

  it("lets the server choose other models through the environment", () => {
    expect(modelFor("smart")).toBe("claude-opus-5-5");
    expect(modelFor("fast")).toBe("claude-haiku-5-5");
    process.env.AI_FAST_MODEL = "claude-sonnet-5-5";
    expect(modelFor("fast")).toBe("claude-sonnet-5-5");
  });
});

describe("usageCostMicros", () => {
  it("charges more for very long Haiku prompts and treats unknown models as the most expensive", () => {
    expect(usageCostMicros({ input_tokens: 200_000, output_tokens: 0 }, "claude-haiku-5-5")).toBe(
      100_000,
    );
    expect(usageCostMicros({ input_tokens: 1_000, output_tokens: 0 }, "claude-new-9")).toBe(5_000);
  });
});
