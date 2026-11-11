import { describe, expect, it } from "vitest";
import {
  addToCartData,
  checkoutData,
  cookieString,
  fbcValue,
  fbpValue,
  maySendToMeta,
  metaUrl,
  pageUrl,
  parsePixelIds,
  plainId,
  purchaseId,
  viewContentData,
} from "../../extensions/web-pixel/src/meta";

const NOW = 1_795_000_000_000;

describe("parsePixelIds", () => {
  it("reads comma separated ids, drops duplicates and keeps at most three", () => {
    expect(parsePixelIds("1234567890123456, 99887766 ,1234567890123456")).toEqual([
      "1234567890123456",
      "99887766",
    ]);
    expect(parsePixelIds("11111111,22222222,33333333,44444444")).toEqual([
      "11111111",
      "22222222",
      "33333333",
    ]);
  });

  it("ignores the word none, short numbers and anything that is not a number", () => {
    expect(parsePixelIds("none")).toEqual([]);
    expect(parsePixelIds("1234567")).toEqual([]);
    expect(parsePixelIds("12345678x,<script>,123456789012345678901")).toEqual([]);
    expect(parsePixelIds(undefined)).toEqual([]);
    expect(parsePixelIds(12345678)).toEqual([]);
  });
});

describe("maySendToMeta", () => {
  it("needs marketing consent and no objection to data sharing", () => {
    expect(maySendToMeta({ marketingAllowed: true, saleOfDataAllowed: true })).toBe(true);
    expect(maySendToMeta({ marketingAllowed: false, saleOfDataAllowed: true })).toBe(false);
    expect(maySendToMeta({ marketingAllowed: true, saleOfDataAllowed: false })).toBe(false);
  });

  it("says no when consent is unknown", () => {
    expect(maySendToMeta(undefined)).toBe(false);
    expect(maySendToMeta(null)).toBe(false);
    expect(maySendToMeta({})).toBe(false);
  });
});

describe("plainId", () => {
  it("keeps the number of a Shopify id", () => {
    expect(plainId("gid://shopify/ProductVariant/44401")).toBe("44401");
    expect(plainId("43482")).toBe("43482");
    expect(plainId(43482)).toBe("43482");
    expect(plainId(null)).toBe("");
    expect(plainId("abc")).toBe("");
  });
});

const variant = {
  id: "44401",
  price: { amount: 749.95, currencyCode: "CAD" },
  product: { id: "43482", title: "  The Collection Snowboard  " },
};

describe("event data", () => {
  it("product view sends the product id as a product group", () => {
    expect(viewContentData(variant)).toEqual({
      content_ids: ["43482"],
      content_type: "product_group",
      content_name: "The Collection Snowboard",
      value: 749.95,
      currency: "CAD",
    });
    expect(viewContentData({ id: "1", product: null })).toBeNull();
    expect(viewContentData(null)).toBeNull();
  });

  it("add to cart sends the variant id, quantity and line total", () => {
    expect(
      addToCartData({
        merchandise: variant,
        quantity: 2,
        cost: { totalAmount: { amount: 1499.9, currencyCode: "CAD" } },
      }),
    ).toEqual({
      content_ids: ["44401"],
      content_type: "product",
      content_name: "The Collection Snowboard",
      num_items: 2,
      value: 1499.9,
      currency: "CAD",
    });
  });

  it("add to cart falls back to the unit price and skips an empty line", () => {
    expect(addToCartData({ merchandise: variant, quantity: 1 })).toMatchObject({
      value: 749.95,
      currency: "CAD",
    });
    expect(addToCartData(null)).toBeNull();
    expect(addToCartData({ merchandise: { id: null } })).toBeNull();
  });

  it("checkout sends every variant once, the item count and the total", () => {
    const checkout = {
      currencyCode: "USD",
      totalPrice: { amount: 61.005, currencyCode: "USD" },
      subtotalPrice: { amount: 50, currencyCode: "USD" },
      lineItems: [
        { quantity: 2, variant: { id: "gid://shopify/ProductVariant/11" } },
        { quantity: 1, variant: { id: "22" } },
        { quantity: 1, variant: { id: "11" } },
        { quantity: 3, variant: null },
        null,
      ],
      order: { id: "5011230720085" },
      token: "secret-token",
    };
    expect(checkoutData(checkout)).toEqual({
      content_ids: ["11", "22"],
      content_type: "product",
      num_items: 7,
      value: 61.01,
      currency: "USD",
    });
    expect(purchaseId(checkout, "sh-1")).toBe("order-5011230720085");
    expect(purchaseId({ order: null }, "sh-1")).toBe("sh-1");
  });

  it("leaves the value out when the amount or the currency is missing", () => {
    expect(checkoutData({ totalPrice: { amount: 10 } })).toEqual({});
    expect(checkoutData({ totalPrice: { amount: Number.NaN, currencyCode: "USD" } })).toEqual({});
    expect(checkoutData({ subtotalPrice: { amount: 5, currencyCode: "eur" } })).toEqual({
      value: 5,
      currency: "EUR",
    });
    expect(checkoutData(undefined)).toEqual({});
  });

  it("never carries personal details from the checkout", () => {
    const checkout = {
      email: "buyer@example.com",
      phone: "+15550001111",
      shippingAddress: { address1: "1 Main St", lastName: "Buyer" },
      totalPrice: { amount: 10, currencyCode: "USD" },
      lineItems: [{ quantity: 1, variant: { id: "11" } }],
    };
    const text = JSON.stringify(checkoutData(checkout));
    expect(text).not.toContain("buyer@example.com");
    expect(text).not.toContain("5550001111");
    expect(text).not.toContain("Main St");
  });
});

describe("pageUrl", () => {
  it("keeps a normal page address without the fragment", () => {
    expect(pageUrl("https://shop.example/products/board?utm_source=fb&fbclid=AbC#reviews")).toBe(
      "https://shop.example/products/board?utm_source=fb&fbclid=AbC",
    );
  });

  it("hides checkout and order links, which carry a secret token", () => {
    expect(pageUrl("https://shop.example/checkouts/cn/Z2NwLXVzLWV4YW1wbGU/thank-you?x=1")).toBe(
      "https://shop.example/checkout",
    );
    expect(pageUrl("https://shop.example/12345/orders/0a1b2c3d4e5f")).toBe(
      "https://shop.example/checkout",
    );
    expect(pageUrl("https://shop.example/account/orders/0a1b2c3d4e5f?key=abc")).toBe(
      "https://shop.example/checkout",
    );
  });

  it("returns nothing for something that is not a web address", () => {
    expect(pageUrl("")).toBe("");
    expect(pageUrl("javascript:alert(1)")).toBe("");
    expect(pageUrl(undefined)).toBe("");
  });

  it("cuts a very long address", () => {
    expect(pageUrl(`https://shop.example/search?q=${"a".repeat(3000)}`)).toHaveLength(1000);
  });
});

describe("browser cookies", () => {
  it("keeps a valid _fbp and makes a new one otherwise", () => {
    expect(fbpValue("fb.1.1596403881668.1116446470", NOW, 0.5)).toBe(
      "fb.1.1596403881668.1116446470",
    );
    expect(fbpValue("", NOW, 0)).toBe(`fb.1.${NOW}.1000000000`);
    expect(fbpValue("something else", NOW, 0.5)).toBe(`fb.1.${NOW}.5500000000`);
    expect(fbpValue(undefined, NOW, 0.999999)).toMatch(/^fb\.1\.\d{13}\.\d{10}$/);
  });

  it("builds _fbc from the fbclid of the landing page", () => {
    expect(fbcValue("", "https://shop.example/?utm=1&fbclid=IwAR2_abc-DEF", NOW)).toBe(
      `fb.1.${NOW}.IwAR2_abc-DEF`,
    );
    expect(fbcValue("", "https://shop.example/?fbclid=IwAR2#top", NOW)).toBe(`fb.1.${NOW}.IwAR2`);
  });

  it("keeps the earlier cookie for the same click and replaces it for a new click", () => {
    const earlier = "fb.1.1700000000000.IwAR2";
    expect(fbcValue(earlier, "https://shop.example/?fbclid=IwAR2", NOW)).toBe(earlier);
    expect(fbcValue(earlier, "https://shop.example/?fbclid=IwAR3", NOW)).toBe(`fb.1.${NOW}.IwAR3`);
    expect(fbcValue(earlier, "https://shop.example/", NOW)).toBe(earlier);
  });

  it("ignores a broken cookie and a suspicious fbclid", () => {
    expect(fbcValue("garbage", "https://shop.example/", NOW)).toBe("");
    expect(fbcValue("", "https://shop.example/?fbclid=%3Cscript%3E", NOW)).toBe("");
    expect(fbcValue("", "https://shop.example/?notfbclid=abc", NOW)).toBe("");
  });

  it("writes a first-party cookie for 90 days", () => {
    expect(cookieString("_fbp", "fb.1.1.1")).toBe(
      "_fbp=fb.1.1.1; path=/; max-age=7776000; SameSite=Lax",
    );
  });
});

describe("metaUrl", () => {
  const ids = { fbp: "fb.1.1596403881668.1116446470", fbc: "" };

  it("builds the request the way Meta's own pixel does", () => {
    const url = new URL(
      metaUrl(
        "1234567890123456",
        { name: "ViewContent", id: "sh-abc", time: NOW + 0.7, data: viewContentData(variant)! },
        { href: "https://shop.example/products/board?a=1&b=2", referrer: "https://google.com/" },
        ids,
      ),
    );
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/tr/");
    const q = url.searchParams;
    expect(q.get("id")).toBe("1234567890123456");
    expect(q.get("ev")).toBe("ViewContent");
    expect(q.get("dl")).toBe("https://shop.example/products/board?a=1&b=2");
    expect(q.get("rl")).toBe("https://google.com/");
    expect(q.get("ts")).toBe(String(NOW));
    expect(q.get("cd[content_ids]")).toBe('["43482"]');
    expect(q.get("cd[content_type]")).toBe("product_group");
    expect(q.get("cd[value]")).toBe("749.95");
    expect(q.get("cd[currency]")).toBe("CAD");
    expect(q.get("fbp")).toBe(ids.fbp);
    expect(q.has("fbc")).toBe(false);
    expect(q.get("eid")).toBe("sh-abc");
  });

  it("escapes every value, so a product name cannot add parameters", () => {
    const url = metaUrl(
      "12345678",
      {
        name: "AddToCart",
        id: "e&id=999",
        time: NOW,
        data: { content_name: "A&B=C #1", content_ids: ['1"2'] },
      },
      { href: "https://shop.example/", referrer: "" },
      { fbp: "", fbc: "" },
    );
    const q = new URL(url).searchParams;
    expect(q.getAll("id")).toEqual(["12345678"]);
    expect(q.get("cd[content_name]")).toBe("A&B=C #1");
    expect(q.get("cd[content_ids]")).toBe('["1\\"2"]');
    expect(q.get("eid")).toBe("e&id=999");
    expect(q.has("rl")).toBe(false);
    expect(q.has("fbp")).toBe(false);
  });

  it("does not leak the checkout link on a purchase", () => {
    const url = metaUrl(
      "12345678",
      { name: "Purchase", id: "order-1", time: NOW, data: {} },
      {
        href: "https://shop.example/checkouts/cn/SECRETTOKEN/thank-you",
        referrer: "https://shop.example/checkouts/cn/SECRETTOKEN",
      },
      { fbp: "", fbc: "" },
    );
    expect(url).not.toContain("SECRETTOKEN");
    expect(new URL(url).searchParams.get("dl")).toBe("https://shop.example/checkout");
  });
});
