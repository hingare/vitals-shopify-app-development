import { describe, expect, it } from "vitest";
import { saleItems } from "./recent-sales.server";

describe("saleItems", () => {
  it("keeps each product once, at most 3 per order, and nothing about the customer", () => {
    const items = saleItems({
      line_items: [
        { product_id: 11, title: "Tee" },
        { product_id: 11, title: "Tee" },
        { product_id: null, title: "Custom tip" },
        { product_id: "22", title: "Cap" },
        { product_id: 33, title: "Mug" },
        { product_id: 44, title: "Bag" },
      ],
    });
    expect(items).toEqual([
      { productId: "11", title: "Tee" },
      { productId: "22", title: "Cap" },
      { productId: "33", title: "Mug" },
    ]);
  });

  it("handles orders without line items", () => {
    expect(saleItems({})).toEqual([]);
  });
});
