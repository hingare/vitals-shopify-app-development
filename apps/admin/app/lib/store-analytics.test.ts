import { describe, expect, it } from "vitest";
import {
  classifyDevice,
  classifySource,
  countEvents,
  hashVisitor,
  normalizePath,
  parsePixelBatch,
  rate,
} from "./store-analytics.server";

describe("parsePixelBatch", () => {
  it("keeps known events and drops the rest", () => {
    const batch = parsePixelBatch({
      k: "key",
      v: "client-1",
      h: "shop.com",
      ua: "Mozilla",
      e: [{ t: "page", p: "/" }, { t: "hack" }, { t: "order", a: 25.5 }, { t: "order", a: -4 }],
    });
    expect(batch?.events.map((e) => e.t)).toEqual(["page", "order", "order"]);
    expect(batch?.events[1].a).toBe(25.5);
    expect(batch?.events[2].a).toBeUndefined();
  });
  it("rejects batches without key, client or events", () => {
    expect(parsePixelBatch({ v: "c", e: [{ t: "page" }] })).toBeNull();
    expect(parsePixelBatch({ k: "k", e: [{ t: "page" }] })).toBeNull();
    expect(parsePixelBatch({ k: "k", v: "c", e: [{ t: "nope" }] })).toBeNull();
    expect(parsePixelBatch("garbage")).toBeNull();
  });
  it("caps the number of events", () => {
    const e = Array.from({ length: 100 }, () => ({ t: "page" }));
    expect(parsePixelBatch({ k: "k", v: "c", e })?.events).toHaveLength(30);
  });
});

describe("classifySource", () => {
  it("detects AI assistants", () => {
    expect(classifySource("https://chatgpt.com/")).toBe("ai");
    expect(classifySource("https://www.perplexity.ai/search")).toBe("ai");
    expect(classifySource("", "?utm_source=chatgpt.com")).toBe("ai");
  });
  it("detects search, social and other websites", () => {
    expect(classifySource("https://www.google.com/")).toBe("search");
    expect(classifySource("https://l.facebook.com/l.php")).toBe("social");
    expect(classifySource("https://t.co/abc")).toBe("social");
    expect(classifySource("https://someblog.net/post")).toBe("referral");
  });
  it("uses UTM and ad click ids", () => {
    expect(classifySource("https://www.google.com/", "?gclid=1")).toBe("paid");
    expect(classifySource("", "?utm_medium=cpc&utm_source=meta")).toBe("paid");
    expect(classifySource("", "?utm_medium=email")).toBe("email");
  });
  it("treats no referrer or the store itself as direct", () => {
    expect(classifySource("")).toBe("direct");
    expect(classifySource("https://www.shop.com/products/a", "", "shop.com")).toBe("direct");
  });
});

describe("classifyDevice", () => {
  it("tells phones, tablets and computers apart", () => {
    expect(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile")).toBe(
      "mobile",
    );
    expect(classifyDevice("Mozilla/5.0 (Linux; Android 14; SM-S918B) Mobile Safari")).toBe(
      "mobile",
    );
    expect(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(classifyDevice("Mozilla/5.0 (Linux; Android 13; SM-X700) Safari")).toBe("tablet");
    expect(classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140")).toBe("desktop");
  });
});

describe("normalizePath", () => {
  it("groups the same page together", () => {
    expect(normalizePath("/collections/sale/products/shirt")).toBe("/products/shirt");
    expect(normalizePath("/en-us/products/Shirt/")).toBe("/products/shirt");
    expect(normalizePath("/cart?x=1")).toBe("/cart");
    expect(normalizePath("")).toBe("/");
  });
});

describe("countEvents", () => {
  it("adds up every step and revenue", () => {
    const c = countEvents([
      { t: "page", p: "/" },
      { t: "page", p: "/" },
      { t: "product" },
      { t: "cart" },
      { t: "checkout" },
      { t: "order", a: 10.1 },
      { t: "order", a: 0.2 },
    ]);
    expect(c).toMatchObject({
      pageViews: 2,
      productViews: 1,
      addToCarts: 1,
      checkouts: 1,
      orders: 2,
    });
    expect(c.revenue).toBe(10.3);
    expect(c.pages.get("/")).toBe(2);
  });
});

describe("helpers", () => {
  it("hashes visitors per shop without exposing the id", () => {
    expect(hashVisitor("a", "c")).not.toBe(hashVisitor("b", "c"));
    expect(hashVisitor("a", "c")).toHaveLength(32);
  });
  it("calculates rates safely", () => {
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(5, 0)).toBe(0);
  });
});
