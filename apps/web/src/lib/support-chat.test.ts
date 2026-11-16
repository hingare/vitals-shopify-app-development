import { brand } from "@app/brand";
import { describe, expect, it } from "vitest";
import { MAX_QUESTION_CHARS } from "./chat-limits";
import { parseChatRequest, supportInstructions } from "./support-chat";

const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

describe("parseChatRequest", () => {
  it("accepts questions and answers taking turns, ending with a question", () => {
    const result = parseChatRequest({
      messages: [user("Hi"), assistant("Hello"), user("  How much is it?  ")],
    });
    expect(result).toEqual({
      ok: true,
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "How much is it?" },
      ],
    });
  });

  it("turns down a conversation that doesn't take turns or doesn't end with a question", () => {
    expect(parseChatRequest({ messages: [assistant("Hi"), user("Q")] })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(parseChatRequest({ messages: [user("Q"), user("Q again")] })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(parseChatRequest({ messages: [user("Q"), assistant("A")] })).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("turns down empty, malformed or overlong requests", () => {
    expect(parseChatRequest(null)).toEqual({ ok: false, error: "invalid" });
    expect(parseChatRequest({ messages: [] })).toEqual({ ok: false, error: "invalid" });
    expect(parseChatRequest({ messages: [user("   ")] })).toEqual({ ok: false, error: "invalid" });
    expect(parseChatRequest({ messages: [{ role: "system", content: "x" }] })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(parseChatRequest({ messages: [user("x".repeat(MAX_QUESTION_CHARS + 1))] })).toEqual({
      ok: false,
      error: "tooLong",
    });
  });

  it("limits how much of a conversation is sent", () => {
    const messages = Array.from({ length: 11 }, (_, i) =>
      i % 2 === 0 ? user("Q") : assistant("A"),
    );
    expect(parseChatRequest({ messages })).toEqual({ ok: false, error: "invalid" });
  });
});

describe("supportInstructions", () => {
  it("names the app and where to get help, and keeps answers to the help center", () => {
    const text = supportInstructions();
    expect(text).toContain(brand.name);
    expect(text).toContain(brand.supportEmail);
    expect(text).toContain("Answer only from the help center");
  });
});
