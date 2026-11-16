import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "./rate-limit.server";
import {
  askAssistant,
  assistantEnabled,
  helpCenterText,
  helpCenterUrl,
  parseAsk,
  resetHelpCenterForTests,
  setSupportClientForTests,
  siteUrl,
  storeDetails,
} from "./support-ai.server";

const T0 = new Date("2026-11-17T10:00:00Z");
const ENV = { SITE_URL: "https://allinone.example.app/" };
const HELP =
  "# AllInOne\n\n> Every tool your Shopify store needs.\n\n## Reviews\n\nhttps://allinone.example.app/help/reviews";
const shop = { id: "shop1", domain: "a.myshopify.com", plan: "starter", trialEndsAt: null };
const question = [{ role: "user" as const, content: "How do I show reviews?" }];

type Params = Parameters<Anthropic["messages"]["create"]>[0];
let calls: Params[] = [];
let reply: () => Promise<unknown>;

const answer =
  (text: string, stop_reason = "end_turn") =>
  async () => ({
    content: [{ type: "text", text }],
    stop_reason,
  });

const fetchText =
  (body: string, status = 200) =>
  async () =>
    new Response(body, { status });

beforeEach(async () => {
  resetRateLimits();
  resetHelpCenterForTests();
  calls = [];
  reply = answer("Turn on **Product reviews**.");
  setSupportClientForTests({
    messages: {
      create: async (params) => {
        calls.push(params as Params);
        return (await reply()) as never;
      },
    },
  });
  // সাহায্য কেন্দ্র আগে থেকেই cache-এ
  await helpCenterText(T0.getTime(), ENV, fetchText(HELP));
});

afterEach(() => setSupportClientForTests(null));

describe("support assistant input", () => {
  it("accepts questions and answers taking turns, starting and ending with a question", () => {
    const messages = [
      { role: "user", content: " First? " },
      { role: "assistant", content: "Answer" },
      { role: "user", content: "Second?" },
    ];
    expect(parseAsk({ messages })).toEqual({
      ok: true,
      messages: [
        { role: "user", content: "First?" },
        { role: "assistant", content: "Answer" },
        { role: "user", content: "Second?" },
      ],
    });
    expect(parseAsk({ messages: messages.slice(0, 2) })).toEqual({ ok: false, error: "invalid" });
    expect(parseAsk({ messages: [messages[1]] })).toEqual({ ok: false, error: "invalid" });
    expect(parseAsk({ messages: [] })).toEqual({ ok: false, error: "invalid" });
    expect(parseAsk(null)).toEqual({ ok: false, error: "invalid" });
    expect(parseAsk({ messages: [{ role: "user", content: 5 }] })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(parseAsk({ messages: [{ role: "user", content: "x".repeat(1001) }] })).toEqual({
      ok: false,
      error: "tooLong",
    });
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x",
    }));
    expect(parseAsk({ messages: eleven })).toEqual({ ok: false, error: "invalid" });
  });

  it("knows where the website and help center are", () => {
    expect(siteUrl(ENV)).toBe("https://allinone.example.app");
    expect(helpCenterUrl(ENV)).toBe("https://allinone.example.app/help");
    // ব্র্যান্ডের নমুনা ঠিকানা (example.com) কাউকে দেখানো হয় না
    expect(helpCenterUrl({})).toBeNull();
    expect(assistantEnabled({})).toBe(true);
    expect(assistantEnabled({ SUPPORT_AI: "off" })).toBe(false);
  });

  it("describes the store's plan for the assistant", () => {
    expect(storeDetails(shop, T0)).toContain("Plan: Starter");
    expect(
      storeDetails({ ...shop, plan: "professional", trialEndsAt: new Date("2026-11-20") }, T0),
    ).toContain("Plan: Professional (free trial)");
    expect(storeDetails({ ...shop, plan: null }, T0)).toContain("Plan: no plan chosen yet");
  });
});

describe("help center text", () => {
  it("is read once and kept for six hours", async () => {
    let fetched = 0;
    const counting = async () => {
      fetched++;
      return new Response(HELP);
    };
    resetHelpCenterForTests();
    expect(await helpCenterText(0, ENV, counting)).toBe(HELP);
    expect(await helpCenterText(5 * 3600_000, ENV, counting)).toBe(HELP);
    expect(fetched).toBe(1);
    expect(await helpCenterText(7 * 3600_000, ENV, counting)).toBe(HELP);
    expect(fetched).toBe(2);
  });

  it("refuses a page that isn't our help center and tries again after 10 minutes", async () => {
    resetHelpCenterForTests();
    expect(await helpCenterText(0, ENV, fetchText("<html>Example Domain</html>"))).toBeNull();
    expect(await helpCenterText(5 * 60_000, ENV, fetchText(HELP))).toBeNull();
    expect(await helpCenterText(11 * 60_000, ENV, fetchText(HELP))).toBe(HELP);
  });

  it("keeps the last good copy when the website is down", async () => {
    const down = async (): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    };
    expect(await helpCenterText(T0.getTime() + 7 * 3600_000, ENV, down)).toBe(HELP);
    expect(await helpCenterText(T0.getTime() + 8 * 3600_000, ENV, fetchText("", 503))).toBe(HELP);
  });
});

describe("support assistant", () => {
  it("answers from the cached help center and the store's details", async () => {
    expect(await askAssistant(shop, question, T0, ENV)).toEqual({
      ok: true,
      answer: "Turn on **Product reviews**.",
    });
    const [params] = calls;
    expect(params).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 1500,
      messages: question,
      output_config: { effort: "low" },
    });
    const system = params!.system as Array<{ text: string; cache_control?: unknown }>;
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(system[0]!.text).toContain(`<help_center>\n${HELP}\n</help_center>`);
    expect(system[0]!.text).not.toContain("a.myshopify.com");
    expect(system[1]!.text).toContain("Store: a.myshopify.com");
    expect(system[1]!.cache_control).toBeUndefined();
  });

  it("uses SUPPORT_AI_MODEL when set", async () => {
    await askAssistant(shop, question, T0, { ...ENV, SUPPORT_AI_MODEL: "claude-sonnet-5-5" });
    expect(calls[0]!.model).toBe("claude-sonnet-5-5");
  });

  it("treats a refusal or an empty answer as a failure", async () => {
    reply = answer("No.", "refusal");
    expect(await askAssistant(shop, question, T0, ENV)).toEqual({ ok: false, error: "failed" });
    reply = answer("   ");
    expect(await askAssistant(shop, question, T0, ENV)).toEqual({ ok: false, error: "failed" });
  });

  it("says when it's busy or not set up", async () => {
    reply = async () => {
      throw new Anthropic.APIConnectionError({ message: "socket hang up" });
    };
    expect(await askAssistant(shop, question, T0, ENV)).toEqual({ ok: false, error: "busy" });
    reply = async () => {
      throw new Anthropic.AuthenticationError(401, {}, "invalid x-api-key", new Headers());
    };
    expect(await askAssistant(shop, question, T0, ENV)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(await askAssistant(shop, question, T0, { ...ENV, SUPPORT_AI: "off" })).toEqual({
      ok: false,
      error: "unavailable",
    });
  });

  it("doesn't call Claude without the help center", async () => {
    resetHelpCenterForTests();
    await helpCenterText(T0.getTime(), ENV, fetchText("", 404));
    expect(await askAssistant(shop, question, T0, ENV)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(calls).toHaveLength(0);
  });

  it("limits questions per store and per day", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await askAssistant(shop, question, T0, ENV)).ok).toBe(true);
    }
    expect(await askAssistant(shop, question, T0, ENV)).toEqual({ ok: false, error: "busy" });
    // আরেক স্টোর তখনও জিজ্ঞেস করতে পারে, যতক্ষণ দিনের মোট সীমা বাকি
    const other = { ...shop, id: "shop2" };
    const env = { ...ENV, SUPPORT_AI_DAILY_LIMIT: "12" };
    expect((await askAssistant(other, question, T0, env)).ok).toBe(true);
    expect((await askAssistant(other, question, T0, env)).ok).toBe(true);
    expect(await askAssistant(other, question, T0, env)).toEqual({ ok: false, error: "limit" });
    expect(calls).toHaveLength(12);
  });
});
