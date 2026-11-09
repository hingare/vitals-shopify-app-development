import { describe, expect, it } from "vitest";
import {
  type CheckoutUpsell,
  discountedPrice,
  pickOffer,
  readOffers,
} from "../../extensions/checkout-upsell/src/offers";

const offer = (o: Partial<CheckoutUpsell> = {}): CheckoutUpsell => ({
  id: "u1",
  triggerProductIds: ["1"],
  productIds: ["gid://shopify/Product/2", "gid://shopify/Product/3"],
  value: { percent: 20 },
  title: "",
  rules: {},
  ...o,
});
const gid = (id: string) => `gid://shopify/Product/${id}`;

describe("checkout upsell", () => {
  it("reads the metafield safely", () => {
    expect(readOffers(undefined)).toEqual([]);
    expect(readOffers("{bad")).toEqual([]);
    expect(readOffers(JSON.stringify({ upsells: [offer()] }))).toHaveLength(1);
  });

  it("offers products not already in the cart when a trigger is in the cart", () => {
    const pick = pickOffer([offer()], [gid("1"), gid("3")], "2026-11-09", undefined);
    expect(pick?.productIds).toEqual([gid("2")]);
    expect(pickOffer([offer()], [gid("9")], "2026-11-09", undefined)).toBeNull();
    expect(pickOffer([offer()], [gid("1"), gid("2"), gid("3")], "2026-11-09", "A")).toBeNull();
  });

  it("respects dates and the A/B group", () => {
    const today = "2026-11-09";
    expect(
      pickOffer([offer({ rules: { endsOn: "2026-11-08" } })], [gid("1")], today, ""),
    ).toBeNull();
    expect(pickOffer([offer({ rules: { abGroup: "B" } })], [gid("1")], today, "A")).toBeNull();
    expect(pickOffer([offer({ rules: { abGroup: "B" } })], [gid("1")], today, "B")).not.toBeNull();
  });

  it("shows a sale price only when the discount is certain", () => {
    expect(discountedPrice(offer(), 15)).toBe(12);
    expect(discountedPrice(offer({ rules: { restricted: true } }), 15)).toBeNull();
    expect(discountedPrice(offer({ rules: { minSubtotal: 50 } }), 15)).toBeNull();
    expect(discountedPrice(offer({ value: { amountEach: 3 } }), 15)).toBeNull();
    expect(discountedPrice(offer({ value: null }), 15)).toBeNull();
  });
});
