import { describe, expect, it } from "vitest";
import { isEmbedEnabled } from "./tools.server";
import { parsePsi } from "./speed.server";
import { tierFromSubscriptionName } from "./plans";

describe("isEmbedEnabled", () => {
  const settings = (disabled: boolean) => `/*
 * Shopify comment header
 */
{"current":{"blocks":{"123":{"type":"shopify://apps/app/blocks/app-tools-embed/abc","disabled":${disabled},"settings":{}}}}}`;

  it("detects our embed when it is on", () => {
    expect(isEmbedEnabled(settings(false))).toBe(true);
  });
  it("treats a disabled embed as off", () => {
    expect(isEmbedEnabled(settings(true))).toBe(false);
  });
  it("handles themes with no blocks", () => {
    expect(isEmbedEnabled('{"current":"Default"}')).toBe(false);
  });
});

describe("parsePsi", () => {
  it("reads the score and core metrics", () => {
    expect(
      parsePsi({
        lighthouseResult: {
          categories: { performance: { score: 0.87 } },
          audits: {
            "largest-contentful-paint": { numericValue: 2345.6 },
            "cumulative-layout-shift": { numericValue: 0.01234 },
            "total-blocking-time": { numericValue: 120.4 },
          },
        },
      }),
    ).toEqual({ score: 87, lcpMs: 2346, cls: 0.012, tbtMs: 120 });
  });
  it("throws when there is no score", () => {
    expect(() => parsePsi({ error: { message: "Unable to fetch" } })).toThrow("Unable to fetch");
  });
});

describe("tierFromSubscriptionName", () => {
  it("maps subscription names to plans", () => {
    expect(tierFromSubscriptionName("Starter Annual")).toBe("starter");
    expect(tierFromSubscriptionName("Professional Monthly")).toBe("professional");
    expect(tierFromSubscriptionName("Something else")).toBeNull();
  });
});
