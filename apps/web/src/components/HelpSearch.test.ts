import { describe, expect, it } from "vitest";
import { searchArticles, type SearchItem } from "./HelpSearch";

const item = (title: string, description = "", keywords = ""): SearchItem => ({
  title,
  description,
  keywords,
  href: `/help/${title.toLowerCase().replace(/\s+/g, "-")}`,
});

const items = [
  item("Sticky Add to Cart", "Keeps the Add to cart button on screen", "Conversion"),
  item("Cart Drawer", "A side cart with upsells", "Upsell"),
  item("Café menu", "Accents are ignored"),
  item("Size Chart", "Tables of sizes, with a cart reminder"),
];

describe("searchArticles", () => {
  it("needs every word typed to match somewhere", () => {
    expect(searchArticles(items, "cart sticky").map((i) => i.title)).toEqual([
      "Sticky Add to Cart",
    ]);
    expect(searchArticles(items, "cart nothing")).toEqual([]);
  });

  it("ranks title matches above description matches", () => {
    expect(searchArticles(items, "cart").map((i) => i.title)).toEqual([
      "Cart Drawer",
      "Sticky Add to Cart",
      "Size Chart",
    ]);
  });

  it("matches the start of words, ignoring case and accents", () => {
    expect(searchArticles(items, "CAFE").map((i) => i.title)).toEqual(["Café menu"]);
    expect(searchArticles(items, "upse").map((i) => i.title)).toEqual(["Cart Drawer"]);
  });

  it("returns nothing for an empty search and respects the limit", () => {
    expect(searchArticles(items, "  ")).toEqual([]);
    expect(searchArticles(items, "cart", 1)).toHaveLength(1);
  });
});
