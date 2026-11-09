import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({ default: {} }));
vi.mock("../shopify.server", () => ({ unauthenticated: {} }));
const { pickPostPurchaseOffer, postPurchaseChange, signChangeset } =
  await import("./post-purchase.server");
const { buildOfferConfigs, parseOfferConfig } = await import("./offers.server");
const { shopFromDest } = await import("./post-purchase");

const p = (id: string) => ({ id, handle: `h${id}`, title: `P${id}` });
const upsell = (config: Record<string, unknown>, id = "u1") => ({
  id,
  type: "upsell",
  active: true,
  config: {
    triggerProducts: [p("1")],
    products: [p("2"), p("3")],
    value: { percent: 20 },
    placements: ["post_purchase"],
    ...config,
  },
});
const purchase = { productIds: ["1"], total: 50, today: "2026-11-09" };

describe("pickPostPurchaseOffer", () => {
  it("picks the first post-purchase upsell triggered by the order, minus bought products", () => {
    const pick = pickPostPurchaseOffer([upsell({ placements: ["cart"] }, "u0"), upsell({})], {
      ...purchase,
      productIds: ["1", "3"],
    });
    expect(pick?.id).toBe("u1");
    expect(pick?.productIds).toEqual(["2"]);
  });

  it("skips offers it cannot check here, out of dates, or below the minimum", () => {
    const rules = (r: Record<string, unknown>) => upsell({ rules: r });
    expect(pickPostPurchaseOffer([rules({ audience: "new" })], purchase)).toBeNull();
    expect(pickPostPurchaseOffer([rules({ abGroup: "A" })], purchase)).toBeNull();
    expect(pickPostPurchaseOffer([rules({ customerTags: ["vip"] })], purchase)).toBeNull();
    expect(pickPostPurchaseOffer([rules({ endsOn: "2026-11-08" })], purchase)).toBeNull();
    expect(pickPostPurchaseOffer([rules({ startsOn: "2026-11-10" })], purchase)).toBeNull();
    expect(pickPostPurchaseOffer([rules({ minSubtotal: 60 })], purchase)).toBeNull();
    expect(pickPostPurchaseOffer([upsell({})], { ...purchase, productIds: ["9"] })).toBeNull();
    expect(pickPostPurchaseOffer([{ ...upsell({}), active: false }], purchase)).toBeNull();
  });
});

describe("postPurchaseChange", () => {
  const cfg = (value: Record<string, number>) => {
    const r = parseOfferConfig("upsell", { products: [p("2")], value });
    if (!r.success) throw new Error("bad");
    return r.data as Parameters<typeof postPurchaseChange>[0];
  };
  it("adds one unit with the offer label as the discount title", () => {
    expect(postPurchaseChange(cfg({ percent: 15 }), 77)).toEqual({
      type: "add_variant",
      variantId: 77,
      quantity: 1,
      discount: { value: 15, valueType: "percentage", title: "Special offer" },
    });
    expect(postPurchaseChange(cfg({ amountEach: 5 }), 77).discount).toEqual({
      value: 5,
      valueType: "fixed_amount",
      title: "Special offer",
    });
    expect(postPurchaseChange(cfg({ percent: 0 }), 77)).not.toHaveProperty("discount");
  });
});

describe("signChangeset", () => {
  it("makes an HS256 JWT signed with the app secret", () => {
    const token = signChangeset(
      "ref1",
      [{ type: "add_variant" }],
      { apiKey: "k", secret: "s" },
      5000,
    );
    const [head, body, sig] = token.split(".");
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    expect(claims).toMatchObject({
      iss: "k",
      sub: "ref1",
      iat: 5,
      changes: [{ type: "add_variant" }],
    });
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(sig).toBe(createHmac("sha256", "s").update(`${head}.${body}`).digest("base64url"));
  });
});

describe("checkout placement", () => {
  it("lists checkout upsells with product gids for the checkout extension", () => {
    const { checkout, storefront } = buildOfferConfigs(
      [upsell({ placements: ["checkout", "cart"] }), upsell({ placements: ["popup"] }, "u2")],
      ["upsells"],
    );
    expect(checkout.upsells).toHaveLength(1);
    expect(checkout.upsells[0]).toMatchObject({
      id: "u1",
      triggerProductIds: ["1"],
      productIds: ["gid://shopify/Product/2", "gid://shopify/Product/3"],
      value: { percent: 20 },
    });
    expect(storefront.upsells).toHaveLength(2);
  });

  it("reads the shop domain from a session token destination", () => {
    expect(shopFromDest("https://a.myshopify.com")).toBe("a.myshopify.com");
    expect(shopFromDest("a.myshopify.com")).toBe("a.myshopify.com");
  });
});
