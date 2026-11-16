import { describe, expect, it, vi } from "vitest";
import { translate } from "@app/i18n";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { AI_BOTS } = await import("./ai-visibility.server");

/** পেজে দেখানো সব লেখার চাবি আছে কিনা (ai-visibility.server.ts-এর reason আর fix-এর সাথে মিলিয়ে) */
const REASONS: Record<string, string[]> = {
  schema: ["off", "embedOff", "productOff", "missing", "duplicates", "live", "on"],
  crawlers: ["open", "blocked", "unknown"],
  descriptions: ["good", "thin", "noProducts"],
  altText: ["good", "missing", "noImages"],
  seoFields: ["good", "empty", "noProducts"],
  reviews: ["off", "none", "good"],
  faq: ["locked", "noProducts", "hidden", "none", "few", "good"],
  homeMeta: ["good", "empty"],
};
const FIXES = [
  "turnOn",
  "openSettings",
  "embed",
  "themes",
  "writeWithAi",
  "products",
  "fillAlt",
  "fillMeta",
  "reviews",
  "upgrade",
  "writeFaq",
  "preferences",
];

const missing = (keys: string[]) => keys.filter((key) => translate("en", key) === key);

describe("AI visibility texts", () => {
  it("has a text for every check, reason, state and fix", () => {
    const keys = Object.entries(REASONS).flatMap(([id, reasons]) => [
      `visibility.check.${id}`,
      ...reasons.map((reason) => `visibility.check.${id}.${reason}`),
    ]);
    keys.push(
      ...["pass", "partial", "fail", "unknown", "locked"].map((s) => `visibility.state.${s}`),
    );
    keys.push(...FIXES.map((fix) => `visibility.fix.${fix}`));
    keys.push(...["success", "warning", "critical"].map((tone) => `visibility.grade.${tone}`));
    expect(missing(keys)).toEqual([]);
  });

  it("names every AI crawler and what it is for", () => {
    const keys = AI_BOTS.flatMap((bot) => [
      `visibility.bot.${bot.token}`,
      `visibility.purpose.${bot.purpose}`,
    ]);
    expect(missing(keys)).toEqual([]);
  });

  it("has every message of the search title section", () => {
    const keys = ["off", "busy", "unknown"].map((code) => `seoMeta.error.${code}`);
    expect(missing(keys)).toEqual([]);
  });
});
