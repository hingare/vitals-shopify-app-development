import { describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({ default: {} }));
const { parseMediaUrls, parseUploadRequest } = await import("./review-media.server");

describe("parseUploadRequest", () => {
  it("accepts up to three small images", () => {
    expect(
      parseUploadRequest({ files: [{ name: "a.jpg", type: "image/jpeg", size: 1000 }] }),
    ).toEqual([{ name: "a.jpg", type: "image/jpeg", size: 1000 }]);
  });

  it("renames odd file names", () => {
    expect(
      parseUploadRequest({ files: [{ name: "../../x<script>", type: "image/png", size: 5 }] }),
    ).toEqual([{ name: "review.png", type: "image/png", size: 5 }]);
  });

  it("rejects too many, too big or wrong type", () => {
    const one = { name: "a.jpg", type: "image/jpeg", size: 10 };
    expect(parseUploadRequest({ files: [one, one, one, one] })).toBeNull();
    expect(parseUploadRequest({ files: [{ ...one, size: 6 * 1024 * 1024 }] })).toBeNull();
    expect(parseUploadRequest({ files: [{ ...one, type: "image/svg+xml" }] })).toBeNull();
    expect(parseUploadRequest({ files: [] })).toBeNull();
  });
});

describe("parseMediaUrls", () => {
  it("keeps only Shopify staged upload URLs", () => {
    expect(
      parseMediaUrls([
        "https://shopify-staged-uploads.storage.googleapis.com/tmp/1/a.jpg",
        "https://evil.example.com/a.jpg",
        "http://shopify-staged-uploads.storage.googleapis.com/tmp/1/b.jpg",
        42,
      ]),
    ).toEqual(["https://shopify-staged-uploads.storage.googleapis.com/tmp/1/a.jpg"]);
    expect(parseMediaUrls(undefined)).toEqual([]);
  });
});
