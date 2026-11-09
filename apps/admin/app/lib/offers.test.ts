import { describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({ default: {} }));
const { buildOfferConfigs, parseOfferConfig } = await import("./offers.server");

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
    expect(ok.success && (ok.data.products[0] as { qty: number }).qty).toBe(1);
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
      message: "Set",
    });
    expect(storefront.bundles[0]).toMatchObject({ items: [{ handle: "h1" }, { handle: "h2" }] });
  });

  it("skips broken saved configs", () => {
    const { fn } = buildOfferConfigs([{ ...volume, config: { tiers: [] } }], ["volume-discounts"]);
    expect(fn.offers).toHaveLength(0);
  });
});
