import { describe, expect, it } from "vitest";
import { isDuplicate, schemaTypes } from "./tools/ai-seo-schema";

describe("AI SEO Schema duplicates", () => {
  const all = {
    productSchema: true,
    organizationSchema: true,
    breadcrumbSchema: true,
    removeThemeDuplicates: true,
  };

  it("reads types from plain objects, lists and @graph, and ignores broken JSON", () => {
    expect(schemaTypes('{"@type":"Product"}')).toEqual(["Product"]);
    expect(schemaTypes('[{"@type":"Product"},{"@type":["Thing","Brand"]}]')).toEqual([
      "Product",
      "Thing",
      "Brand",
    ]);
    expect(schemaTypes('{"@graph":[{"@type":"Organization"},{"@type":"WebSite"}]}')).toEqual([
      "Organization",
      "WebSite",
    ]);
    expect(schemaTypes("{not json")).toEqual([]);
  });

  it("removes the theme's copy only when every type in it is one we already give", () => {
    const ours = new Set(["Product", "BreadcrumbList"]);
    expect(isDuplicate(["Product"], ours, all)).toBe(true);
    expect(isDuplicate(["Product", "BreadcrumbList"], ours, all)).toBe(true);
    // কিছু হারাবে, তাই থাকে
    expect(isDuplicate(["Product", "FAQPage"], ours, all)).toBe(false);
    expect(isDuplicate(["Organization"], ours, all)).toBe(false);
    expect(isDuplicate([], ours, all)).toBe(false);
    expect(isDuplicate(["Product"], ours, { ...all, productSchema: false })).toBe(false);
  });
});
