import { describe, expect, it } from "vitest";
import { clip, fillFacts, formatDate, plainText, readingMinutes } from "./text";

describe("plainText", () => {
  it("drops the markup and keeps the words", () => {
    expect(plainText("Press **Save**, see [the guide](/help/x) and type `{n}`.")).toBe(
      "Press Save, see the guide and type {n}.",
    );
  });

  it("handles a link inside bold", () => {
    expect(plainText("**[Speed Guard](/help/speed-guard)** runs")).toBe("Speed Guard runs");
  });

  it("leaves text without markup alone", () => {
    expect(plainText("No markup [here] (at all)")).toBe("No markup [here] (at all)");
  });
});

describe("fillFacts", () => {
  it("fills known placeholders and leaves the app's own ones", () => {
    expect(
      fillFacts("{brand} costs {proPrice}; `{product}` stays", { brand: "Acme", proPrice: "$9" }),
    ).toBe("Acme costs $9; `{product}` stays");
  });
});

describe("clip", () => {
  it("keeps short text as it is", () => {
    expect(clip("Short text.", 160)).toBe("Short text.");
  });

  it("cuts long text at a word and adds an ellipsis", () => {
    const result = clip("one two three four five six seven eight nine ten", 20);
    expect(result).toBe("one two three four…");
    expect(result.length).toBeLessThanOrEqual(20);
  });
});

describe("readingMinutes", () => {
  it("counts about 220 words a minute, and at least one", () => {
    expect(readingMinutes(["just a few words"])).toBe(1);
    expect(readingMinutes([Array.from({ length: 1100 }, () => "word").join(" ")])).toBe(5);
  });
});

describe("formatDate", () => {
  it("writes a content date in the visitor's language, on the same day everywhere", () => {
    expect(formatDate("2026-11-16", "en")).toBe("November 16, 2026");
  });
});
