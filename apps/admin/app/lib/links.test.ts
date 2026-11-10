import { beforeAll, describe, expect, it } from "vitest";
import {
  clickUrl,
  isValidClick,
  isValidPushClick,
  openPixelUrl,
  pushClickUrl,
  readOpenToken,
  readUnsubscribeToken,
  unsubscribeUrl,
} from "./links.server";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  process.env.SHOPIFY_APP_URL = "https://app.test/";
});

describe("email links", () => {
  it("counts an open only for a pixel link we made", () => {
    const url = openPixelUrl("msg1");
    expect(url.startsWith("https://app.test/e/o/msg1.")).toBe(true);
    const token = url.split("/e/o/")[1] ?? "";
    expect(readOpenToken(token)).toBe("msg1");
    expect(readOpenToken(token.replace("msg1", "msg2"))).toBeNull();
    expect(readOpenToken("msg1")).toBeNull();
  });

  it("redirects a click only to the address that was signed", () => {
    const url = new URL(clickUrl("msg1", "https://shop.com/p?a=1"));
    const signature = url.searchParams.get("s") ?? "";
    expect(url.searchParams.get("u")).toBe("https://shop.com/p?a=1");
    expect(isValidClick("msg1", "https://shop.com/p?a=1", signature)).toBe(true);
    // অন্য ঠিকানা বা অন্য বার্তায় সই চলে না (open redirect বন্ধ)
    expect(isValidClick("msg1", "https://evil.com", signature)).toBe(false);
    expect(isValidClick("msg2", "https://shop.com/p?a=1", signature)).toBe(false);
  });

  it("never redirects to a non-https address, even with a matching signature", () => {
    const url = new URL(clickUrl("msg1", "javascript:alert(1)"));
    expect(isValidClick("msg1", "javascript:alert(1)", url.searchParams.get("s") ?? "")).toBe(
      false,
    );
  });

  it("unsubscribes only the address inside the signed token", () => {
    const token = unsubscribeUrl("shop1", "a@b.com").split("/e/u/")[1] ?? "";
    expect(readUnsubscribeToken(token)).toEqual({ shopId: "shop1", email: "a@b.com" });
    expect(readUnsubscribeToken(`x${token}`)).toBeNull();
    expect(readUnsubscribeToken("")).toBeNull();
  });

  it("signs push click links separately from email click links", () => {
    const push = new URL(pushClickUrl("c1", "https://shop.com/"));
    const signature = push.searchParams.get("s") ?? "";
    expect(isValidPushClick("c1", "https://shop.com/", signature)).toBe(true);
    expect(isValidClick("c1", "https://shop.com/", signature)).toBe(false);
  });
});
