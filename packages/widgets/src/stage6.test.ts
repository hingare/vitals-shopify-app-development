import { describe, expect, it } from "vitest";
import { isDuplicate, schemaTypes } from "./tools/ai-seo-schema";
import {
  parseResults,
  pushRecent,
  readRecent,
  splitList,
  suggestUrl,
} from "./tools/instant-search";
import { newKey } from "./keys";
import { mergeMessages, needsEmail, unreadSince, type ChatMessage } from "./tools/live-chat";
import {
  canonicalPath,
  cleanHref,
  excluded,
  gzipBase64,
  readState,
  sampled,
} from "./tools/visitor-recordings";

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

describe("Instant Search", () => {
  it("asks Shopify for each kind of result the merchant wants to show", () => {
    const url = new URL(
      suggestUrl("/fr/", "linen shirt", { limit: 6, showCollections: false, showPages: true }),
      "https://shop.example",
    );
    expect(url.pathname).toBe("/fr/search/suggest.json");
    expect(url.searchParams.get("q")).toBe("linen shirt");
    expect(url.searchParams.get("resources[type]")).toBe("query,product,page");
    expect(url.searchParams.get("resources[limit]")).toBe("6");
    expect(url.searchParams.get("resources[limit_scope]")).toBe("each");
    const capped = new URL(
      suggestUrl("/", "x", { limit: 40, showCollections: true, showPages: false }),
      "https://shop.example",
    );
    expect(capped.searchParams.get("resources[limit]")).toBe("10");
  });

  it("keeps only what it needs from Shopify's answer, and only links inside the store", () => {
    const results = parseResults({
      resources: {
        results: {
          queries: [{ text: "linen shirt", url: "/search?q=linen+shirt" }, { text: "" }],
          products: [
            {
              title: "Linen Shirt",
              url: "/products/linen-shirt?_pos=1",
              price: "19.90",
              compare_at_price_min: "29.00",
              available: true,
              featured_image: { url: "//cdn.shopify.com/a.jpg" },
              variants: [{ id: 11, available: true }],
            },
            {
              title: "Linen Pants",
              url: "/products/linen-pants",
              image: "https://cdn.shopify.com/b.jpg",
              price: "45.00",
              compare_at_price_min: "0.00",
              available: false,
              variants: [
                { id: 21, available: false },
                { id: 22, available: false },
              ],
            },
            { title: "Elsewhere", url: "https://evil.example/products/x", price: "1.00" },
            { title: "Protocol relative", url: "//evil.example/x" },
            null,
          ],
          collections: [{ title: "Summer", url: "/collections/summer" }],
          pages: "not a list",
        },
      },
    });
    expect(results.queries).toEqual([{ title: "linen shirt", url: "/search?q=linen+shirt" }]);
    expect(results.products).toEqual([
      {
        title: "Linen Shirt",
        url: "/products/linen-shirt?_pos=1",
        image: "//cdn.shopify.com/a.jpg",
        price: 1990,
        compareAt: 2900,
        available: true,
        variantId: 11,
      },
      {
        title: "Linen Pants",
        url: "/products/linen-pants",
        image: "https://cdn.shopify.com/b.jpg",
        price: 4500,
        compareAt: 0,
        available: false,
        variantId: null,
      },
    ]);
    expect(results.collections).toEqual([{ title: "Summer", url: "/collections/summer" }]);
    expect(results.pages).toEqual([]);
    expect(parseResults(null)).toEqual({ queries: [], products: [], collections: [], pages: [] });
  });

  it("keeps popular and recent searches short and without repeats", () => {
    expect(splitList(" t-shirts, Summer sale,,t-shirts , hats")).toEqual([
      "t-shirts",
      "Summer sale",
      "hats",
    ]);
    expect(pushRecent(["hats", "Shirts", "socks"], "shirts")).toEqual(["shirts", "hats", "socks"]);
    expect(pushRecent(["a", "b", "c", "d", "e"], "f")).toEqual(["f", "a", "b", "c", "d"]);
    expect(pushRecent(["a"], "   ")).toEqual(["a"]);
    expect(readRecent('["a", 2, "b"]')).toEqual(["a", "b"]);
    expect(readRecent("{broken")).toEqual([]);
  });
});

describe("Live Chat", () => {
  const msg = (id: string, from: ChatMessage["from"], at: string): ChatMessage => ({
    id,
    from,
    body: id,
    at,
  });

  it("makes a long random key the server accepts", () => {
    const a = newKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newKey()).not.toBe(a);
  });

  it("adds new messages once and keeps them in time order", () => {
    const first = [msg("a", "visitor", "2026-11-14T10:00:00.000Z")];
    expect(mergeMessages(first, [])).toBe(first);
    const merged = mergeMessages(first, [
      msg("c", "store", "2026-11-14T10:02:00.000Z"),
      msg("a", "visitor", "2026-11-14T10:00:00.000Z"),
      msg("b", "store", "2026-11-14T10:01:00.000Z"),
    ]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("asks for an email only when the merchant's setting needs one", () => {
    expect(needsEmail("always", true, false)).toBe(true);
    expect(needsEmail("always", true, true)).toBe(false);
    expect(needsEmail("offline", true, false)).toBe(false);
    expect(needsEmail("offline", false, false)).toBe(true);
    // অনলাইন কিনা জানার আগে চাওয়া হয় না
    expect(needsEmail("offline", null, false)).toBe(false);
    expect(needsEmail("never", false, false)).toBe(false);
  });

  it("counts store replies the shopper has not seen yet", () => {
    const messages = [
      msg("a", "visitor", "2026-11-14T10:00:00.000Z"),
      msg("b", "store", "2026-11-14T10:01:00.000Z"),
      msg("c", "store", "2026-11-14T10:02:00.000Z"),
    ];
    expect(unreadSince(messages, null)).toBe(2);
    expect(unreadSince(messages, "2026-11-14T10:01:00.000Z")).toBe(1);
    expect(unreadSince(messages, "2026-11-14T10:02:00.000Z")).toBe(0);
  });
});

describe("Visitor Recordings", () => {
  it("picks about the share of visits the merchant chose", () => {
    expect(sampled(50, 0.49)).toBe(true);
    expect(sampled(50, 0.5)).toBe(false);
    expect(sampled(100, 0.999)).toBe(true);
    expect(sampled(1, 0.02)).toBe(false);
  });

  it("never records account, password or app pages, in any language, and skips the merchant's paths", () => {
    expect(canonicalPath("/fr/account/login", "/fr/")).toBe("/account/login");
    expect(canonicalPath("/fr", "/fr/")).toBe("/");
    expect(canonicalPath("/products/a", "/")).toBe("/products/a");
    for (const path of ["/account", "/account/orders/1", "/password", "/apps/app-tools/track"]) {
      expect(excluded(path, "")).toBe(true);
    }
    expect(excluded("/accounts-of-a-brand", "")).toBe(false);
    expect(excluded("/pages/contact", "/pages/contact, /blogs/news/")).toBe(true);
    expect(excluded("/blogs/news/a-post", "/pages/contact, /blogs/news/")).toBe(true);
    expect(excluded("/pages/contact-us", "/pages/contact")).toBe(false);
    expect(excluded("/products/a", "products, /")).toBe(false);
  });

  it("keeps page addresses but drops their query and hash", () => {
    expect(cleanHref("https://shop.example/products/a?email=x@y.z#top")).toBe(
      "https://shop.example/products/a",
    );
    expect(cleanHref("not a url")).toBe("");
  });

  it("continues the same recording across pages until the visit goes quiet for 30 minutes", () => {
    const state = { k: "a".repeat(43), n: 3, t0: 1_000, t: 2_000 };
    expect(readState(JSON.stringify(state), 2_000 + 29 * 60_000)).toEqual(state);
    expect(readState(JSON.stringify(state), 2_000 + 31 * 60_000)).toBeNull();
    expect(readState(JSON.stringify({ ...state, k: "short" }), 2_000)).toBeNull();
    expect(readState(JSON.stringify({ ...state, n: -1 }), 2_000)).toBeNull();
    expect(readState("{broken", 2_000)).toBeNull();
    expect(readState(null, 2_000)).toBeNull();
  });

  it("gzips what it sends, the way the server unzips it", async () => {
    const { gunzipSync } = await import("node:zlib");
    const text = JSON.stringify([{ type: 4, timestamp: 1, data: { href: "https://s.example/" } }]);
    const data = await gzipBase64(text);
    expect(gunzipSync(Buffer.from(data, "base64")).toString("utf8")).toBe(text);
  });
});
