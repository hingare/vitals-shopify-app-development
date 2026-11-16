import { describe, expect, it } from "vitest";
import { createT, resolveLocale, translate } from "./index";

describe("i18n", () => {
  it("resolves Shopify locale codes and falls back to English", () => {
    expect(resolveLocale("en-US")).toBe("en");
    expect(resolveLocale("bn-BD")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("fills variables and falls back to the key for unknown messages", () => {
    expect(translate("en", "plans.trial", { days: 7 })).toBe("7-day free trial");
    expect(translate("en", "missing.key")).toBe("missing.key");
  });

  it("gives the same translate function for a language every time (stable in React effects)", () => {
    expect(createT("en")).toBe(createT("en"));
    expect(createT("en")("plans.trial", { days: 3 })).toBe("3-day free trial");
  });
});
