import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_EDITOR,
  campaignLink,
  segmentGid,
} from "../../extensions/segment-campaign/src/segment";
import { isSegmentId } from "./segments.server";

const extension = new URL("../../extensions/segment-campaign/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, extension), "utf8");

describe("segment action extension", () => {
  it("accepts Shopify's segment id in either form, and nothing else", () => {
    expect(segmentGid("gid://shopify/Segment/5")).toBe("gid://shopify/Segment/5");
    expect(segmentGid(" 5 ")).toBe("gid://shopify/Segment/5");
    for (const bad of [undefined, null, 5, "", "gid://shopify/Customer/5", "abc"]) {
      expect(segmentGid(bad)).toBeNull();
    }
  });

  it("opens the campaign editor with the segment chosen", () => {
    const link = campaignLink("gid://shopify/Segment/5");
    const url = new URL(link, "https://app.example.com");
    expect(url.pathname).toBe(CAMPAIGN_EDITOR);
    const segment = url.searchParams.get("segment");
    expect(segment).toBe("gid://shopify/Segment/5");
    // editor-এর loader যে id মেনে নেয়, লিংকে ঠিক সেটাই যায়
    expect(isSegmentId(segment)).toBe(true);
    // /app/marketing/campaigns/new চালায় app.marketing.campaigns.$id.tsx
    expect(CAMPAIGN_EDITOR).toBe("/app/marketing/campaigns/new");
    expect(existsSync(new URL("../routes/app.marketing.campaigns.$id.tsx", import.meta.url))).toBe(
      true,
    );
  });

  it("shows in the Use segment menu and has every text it uses", () => {
    const toml = read("shopify.extension.toml");
    expect(toml).toContain('target = "admin.customer-segment-details.action.render"');
    expect(toml).toContain('module = "./src/ActionExtension.tsx"');
    expect(toml).toContain('name = "t:name"');

    const locale = JSON.parse(read("locales/en.default.json")) as Record<string, unknown>;
    const used = [...read("src/ActionExtension.tsx").matchAll(/translate\("([^"]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(used.length).toBeGreaterThan(5);
    for (const key of ["name", ...used]) {
      expect(locale[key], key).toBeDefined();
    }
    // সংখ্যার লেখা এক আর বহুবচনে আলাদা
    expect(locale.members).toEqual({ one: expect.any(String), other: expect.any(String) });
  });
});
