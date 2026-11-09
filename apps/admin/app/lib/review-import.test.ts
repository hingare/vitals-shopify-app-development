import { describe, expect, it, vi } from "vitest";
import { parseCsv } from "./csv";

vi.mock("../db.server", () => ({ default: {} }));
const { mapRow } = await import("./review-import.server");

describe("parseCsv", () => {
  it("handles quotes, commas and new lines inside cells", () => {
    const csv =
      '﻿Rating,Body,Reviewer Name\r\n5,"Great, really ""great""\nproduct",Ana\n\n4,Ok,Bo\n';
    expect(parseCsv(csv)).toEqual([
      { rating: "5", body: 'Great, really "great"\nproduct', reviewer_name: "Ana" },
      { rating: "4", body: "Ok", reviewer_name: "Bo" },
    ]);
  });

  it("stops after the row limit", () => {
    expect(parseCsv("a\n1\n2\n3\n", 2)).toHaveLength(2);
  });
});

describe("mapRow", () => {
  it("reads a Judge.me style row", () => {
    const result = mapRow({
      rating: "4",
      body: "Nice",
      title: "Good",
      reviewer_name: "Karim",
      reviewer_email: "K@Example.com",
      product_id: "gid://shopify/Product/42",
      review_date: "2025-01-02",
      reply: "Thanks!",
    });
    expect(result).toMatchObject({
      ok: true,
      row: { rating: 4, productId: "42", email: "k@example.com", reply: "Thanks!", title: "Good" },
    });
  });

  it("falls back to the product handle and a default name", () => {
    const result = mapRow({ stars: "5", review: "Wow", product_handle: "/products/Blue-Shirt" });
    expect(result).toMatchObject({
      ok: true,
      row: { productId: null, handle: "blue-shirt", name: "Customer", email: null },
    });
  });

  it("explains rows it cannot use", () => {
    expect(mapRow({ rating: "9", body: "x", product_id: "1" })).toEqual({
      ok: false,
      reason: "rating",
    });
    expect(mapRow({ rating: "5", body: "", product_id: "1" })).toEqual({
      ok: false,
      reason: "body",
    });
    expect(mapRow({ rating: "5", body: "x" })).toEqual({ ok: false, reason: "product" });
  });

  it("ignores future or invalid dates", () => {
    const result = mapRow({ rating: "5", body: "x", product_id: "1", date: "3000-01-01" });
    expect(result.ok && result.row.createdAt).toBeNull();
  });
});
