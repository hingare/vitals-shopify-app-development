import { describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({ default: {} }));

const { initialStatus, parseReviewInput, shortName, summarize } = await import("./reviews.server");
const { allowRequest, resetRateLimits } = await import("./rate-limit.server");

const valid = {
  productId: "123456789",
  rating: 5,
  title: "Great",
  body: "Loved it",
  name: "Rahim Uddin",
  email: "rahim@example.com",
};

describe("parseReviewInput", () => {
  it("accepts a normal review and trims text", () => {
    const result = parseReviewInput({ ...valid, body: "  Loved it  " });
    expect(result).toMatchObject({ ok: true, input: { body: "Loved it", rating: 5 } });
  });

  it("allows an empty email and title", () => {
    expect(parseReviewInput({ ...valid, email: "", title: undefined }).ok).toBe(true);
  });

  it("rejects bad ratings, product ids and empty bodies", () => {
    expect(parseReviewInput({ ...valid, rating: 6 })).toEqual({ ok: false, error: "invalid" });
    expect(parseReviewInput({ ...valid, rating: 0 })).toEqual({ ok: false, error: "invalid" });
    expect(parseReviewInput({ ...valid, productId: "gid://x" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(parseReviewInput({ ...valid, body: "   " })).toEqual({ ok: false, error: "invalid" });
    expect(parseReviewInput({ ...valid, email: "not-an-email" })).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("flags bots that fill the hidden field", () => {
    expect(parseReviewInput({ ...valid, website: "http://spam" })).toEqual({
      ok: false,
      error: "spam",
    });
  });
});

describe("initialStatus", () => {
  it("follows the auto-publish setting", () => {
    expect(initialStatus(5, "none")).toBe("pending");
    expect(initialStatus(4, "4plus")).toBe("published");
    expect(initialStatus(3, "4plus")).toBe("pending");
    expect(initialStatus(1, "all")).toBe("published");
  });
});

describe("summarize", () => {
  it("computes average, count and distribution", () => {
    const s = summarize([
      { rating: 5, _count: { _all: 3 } },
      { rating: 4, _count: { _all: 1 } },
      { rating: 1, _count: { _all: 1 } },
    ]);
    expect(s).toEqual({ average: 4, count: 5, distribution: [1, 0, 0, 1, 3] });
  });

  it("returns zeros with no reviews", () => {
    expect(summarize([])).toEqual({ average: 0, count: 0, distribution: [0, 0, 0, 0, 0] });
  });
});

describe("shortName", () => {
  it("hides the full surname", () => {
    expect(shortName("Rahim Uddin")).toBe("Rahim U.");
    expect(shortName("  Karim  ")).toBe("Karim");
    expect(shortName("Abdul Karim ahmed")).toBe("Abdul A.");
  });
});

describe("allowRequest", () => {
  it("blocks after the limit within the window and recovers later", () => {
    resetRateLimits();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(allowRequest("k", 3, 1000, now)).toBe(true);
    expect(allowRequest("k", 3, 1000, now + 10)).toBe(false);
    expect(allowRequest("k", 3, 1000, now + 2000)).toBe(true);
  });
});
