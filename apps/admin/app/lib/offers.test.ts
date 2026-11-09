import { describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({ default: {} }));
const { buildOfferConfigs, offerLabel, parseOfferConfig } = await import("./offers.server");
const { parseOfferAttribution } = await import("./offer-stats.server");

const p = (id: string) => ({ id, handle: `h${id}`, title: `P${id}` });

describe("parseOfferConfig", () => {
  it("accepts a volume offer and needs distinct tier quantities", () => {
    const ok = parseOfferConfig("volume", {
      products: [p("1")],
      tiers: [
        { minQty: 2, value: { percent: 10 } },
        { minQty: 3, value: { amountEach: 5 } },
      ],
    });
    expect(ok.success).toBe(true);
    const dup = parseOfferConfig("volume", {
      tiers: [
        { minQty: 2, value: { percent: 10 } },
        { minQty: 2, value: { percent: 20 } },
      ],
    });
    expect(dup.success).toBe(false);
  });

  it("needs exactly one of percent or amount", () => {
    expect(
      parseOfferConfig("volume", { tiers: [{ minQty: 2, value: { percent: 5, amountEach: 1 } }] })
        .success,
    ).toBe(false);
    expect(parseOfferConfig("volume", { tiers: [{ minQty: 2, value: {} }] }).success).toBe(false);
  });

  it("needs two to five different products in a bundle", () => {
    expect(parseOfferConfig("bundle", { products: [p("1")], value: { percent: 10 } }).success).toBe(
      false,
    );
    expect(
      parseOfferConfig("bundle", { products: [p("1"), p("1")], value: { percent: 10 } }).success,
    ).toBe(false);
    const ok = parseOfferConfig("bundle", { products: [p("1"), p("2")], value: { percent: 10 } });
    expect(ok.success && (ok.data as { products: Array<{ qty: number }> }).products[0]!.qty).toBe(
      1,
    );
  });
});

describe("buildOfferConfigs", () => {
  const volume = {
    id: "v",
    type: "volume",
    active: true,
    config: {
      products: [p("1")],
      tiers: [
        { minQty: 3, value: { percent: 15 } },
        { minQty: 2, value: { percent: 10 } },
      ],
    },
  };
  const bundle = {
    id: "b",
    type: "bundle",
    active: true,
    config: { products: [p("1"), { ...p("2"), qty: 2 }], value: { percent: 20 }, title: "Set" },
  };

  it("includes only active offers whose tool is on, with sorted tiers", () => {
    const { fn, storefront } = buildOfferConfigs(
      [volume, bundle, { ...volume, id: "off", active: false }],
      ["volume-discounts"],
    );
    expect(fn.offers).toHaveLength(1);
    expect(fn.offers[0]).toMatchObject({
      type: "volume",
      productIds: ["1"],
      tiers: [{ minQty: 2 }, { minQty: 3 }],
    });
    expect(storefront.bundles).toHaveLength(0);
  });

  it("builds bundle items for the function and the storefront", () => {
    const { fn, storefront } = buildOfferConfigs([bundle], ["bundles"]);
    expect(fn.offers[0]).toEqual({
      type: "bundle",
      id: "b",
      items: [
        { productId: "1", qty: 1 },
        { productId: "2", qty: 2 },
      ],
      value: { percent: 20 },
      message: "Bundle discount",
      priority: 0,
      rules: {},
    });
    expect(storefront.bundles[0]).toMatchObject({ items: [{ handle: "h1" }, { handle: "h2" }] });
  });

  it("skips broken saved configs", () => {
    const { fn } = buildOfferConfigs([{ ...volume, config: { tiers: [] } }], ["volume-discounts"]);
    expect(fn.offers).toHaveLength(0);
  });
});

describe("offer rules, gifts and BOGO", () => {
  const gift = {
    id: "g",
    type: "gift",
    active: true,
    config: {
      gift: { id: "55", productId: "5", handle: "socks", title: "Socks" },
      rules: { minSubtotal: 50, abGroup: "B", customerTags: ["VIP"], audience: "returning" },
    },
  };
  const bogo = {
    id: "x",
    type: "bogo",
    active: true,
    config: { buyQty: 2, getQty: 1, value: { percent: 100 }, maxUses: 0, message: "2+1 free" },
  };

  it("passes rules, customer tags and the conflict mode to the function", () => {
    const { fn, input, storefront } = buildOfferConfigs([gift, bogo], ["free-gifts", "bogo"], {
      conflict: "priority",
    });
    expect(fn.conflict).toBe("priority");
    expect(fn.offers[0]).toMatchObject({
      type: "gift",
      giftVariantId: "55",
      giftQty: 1,
      rules: { minSubtotal: 50, abGroup: "B", customerTags: ["VIP"], audience: "returning" },
    });
    expect(fn.offers[1]).toMatchObject({
      type: "bogo",
      buyQty: 2,
      getQty: 1,
      maxUses: 0,
      message: "2+1 free",
    });
    expect(input).toEqual({ customerTags: ["VIP"] });
    expect(storefront.ab).toBe(true);
    expect(storefront.gifts[0]).toMatchObject({
      variantId: "55",
      rules: { minSubtotal: 50, abGroup: "B", restricted: true },
    });
  });

  it("needs something that unlocks a gift and valid dates", () => {
    expect(
      parseOfferConfig("gift", { gift: { id: "1", productId: "1", handle: "a", title: "A" } })
        .success,
    ).toBe(false);
    expect(
      parseOfferConfig("volume", {
        tiers: [{ minQty: 2, value: { percent: 10 } }],
        rules: { startsOn: "2026-12-01", endsOn: "2026-11-01" },
      }).success,
    ).toBe(false);
    expect(
      parseOfferConfig("bogo", { buyQty: 1, getQty: 1, value: { percent: 50 }, rules: null })
        .success,
    ).toBe(true);
  });

  it("uses a default label when the merchant leaves it empty", () => {
    expect(offerLabel("gift", "")).toBe("Free gift");
    expect(offerLabel("bogo", " Weekend deal ")).toBe("Weekend deal");
  });
});

describe("parseOfferAttribution", () => {
  const offers = [
    { id: "v", type: "volume", config: { message: "Buy 2 save 10%" } },
    { id: "g", type: "gift", config: {} },
  ];

  it("matches order discounts to offers by label and sums each offer's discount", () => {
    const result = parseOfferAttribution(
      {
        total_price: "120.00",
        note_attributes: [{ name: "_app_ab", value: "B" }],
        discount_applications: [
          { type: "automatic", title: "Buy 2 save 10%" },
          { type: "discount_code", title: "Free gift" },
          { type: "automatic", title: "free gift" },
        ],
        line_items: [
          { discount_allocations: [{ amount: "4.00", discount_application_index: 0 }] },
          {
            discount_allocations: [
              { amount: "6.50", discount_application_index: 0 },
              { amount: "9.00", discount_application_index: 1 },
            ],
          },
          { discount_allocations: [{ amount: "15.00", discount_application_index: 2 }] },
        ],
      },
      offers,
    );
    expect(Object.fromEntries(result.discounts)).toEqual({ v: 10.5, g: 15 });
    expect(result.revenue).toBe(120);
    expect(result.abGroup).toBe("B");
  });

  it("ignores orders without our discounts and unknown groups", () => {
    const result = parseOfferAttribution(
      { total_price: "abc", note_attributes: [{ name: "_app_ab", value: "Z" }] },
      offers,
    );
    expect(result.discounts.size).toBe(0);
    expect(result.revenue).toBe(0);
    expect(result.abGroup).toBeNull();
  });
});
