import { describe, expect, it } from "vitest";
import { placementSchema, readPlacement } from "./placement";

describe("placement", () => {
  it("defaults to letting widgets find their spot", () => {
    expect(readPlacement(null)).toEqual({
      productAnchor: "",
      productWhere: "after",
      cartAnchor: "",
      cartWhere: "after",
    });
  });

  it("accepts CSS selectors and rejects markup or style blocks", () => {
    expect(placementSchema.safeParse({ productAnchor: "main .product-form > div" }).success).toBe(
      true,
    );
    expect(placementSchema.safeParse({ productAnchor: "<script>" }).success).toBe(false);
    expect(placementSchema.safeParse({ cartAnchor: "a{color:red}" }).success).toBe(false);
  });

  it("falls back to defaults for broken saved data", () => {
    expect(readPlacement({ productWhere: "middle" }).productWhere).toBe("after");
  });
});
