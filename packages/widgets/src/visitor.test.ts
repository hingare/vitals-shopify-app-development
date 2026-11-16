import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanVisitorInfo, contactInfo, identifyVisitor } from "./visitor";

describe("telling Shopify who the visitor is", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubShopify = (allowed: boolean | null, appId: string | null = "4242") => {
    const visitor = vi.fn(() => true);
    vi.stubGlobal("window", {
      __APP_CONFIG__: { appId },
      Shopify: {
        analytics: { visitor },
        ...(allowed === null
          ? {}
          : {
              customerPrivacy: {
                analyticsProcessingAllowed: () => allowed,
                setTrackingConsent: () => undefined,
              },
            }),
      },
    });
    return visitor;
  };

  it("keeps only a real-looking email or phone", () => {
    expect(cleanVisitorInfo({ email: " ana@example.com " })).toEqual({ email: "ana@example.com" });
    expect(cleanVisitorInfo({ phone: "+1 (555) 555-5555" })).toEqual({
      phone: "+1 (555) 555-5555",
    });
    expect(cleanVisitorInfo({ email: "not an email", phone: "12" })).toBeNull();
    expect(cleanVisitorInfo({ email: "" })).toBeNull();
    expect(cleanVisitorInfo({ phone: "1234567890123456" })).toBeNull();
  });

  it("reads an email-or-phone field", () => {
    expect(contactInfo(" ana@example.com ")).toEqual({ email: "ana@example.com" });
    expect(contactInfo("+880 1711 000000")).toEqual({ phone: "+880 1711 000000" });
  });

  it("sends the email with the app id once the visitor allows analytics", async () => {
    const visitor = stubShopify(true);
    await identifyVisitor({ email: "ana@example.com" });
    expect(visitor).toHaveBeenCalledWith({ email: "ana@example.com" }, { appId: "4242" });
  });

  it("sends nothing when the visitor turned analytics down", async () => {
    const visitor = stubShopify(false);
    await identifyVisitor({ email: "ana@example.com" });
    expect(visitor).not.toHaveBeenCalled();
  });

  it("sends nothing for a typo, and never breaks the form when Shopify throws", async () => {
    const visitor = stubShopify(null, null);
    await identifyVisitor({ email: "ana@" });
    expect(visitor).not.toHaveBeenCalled();
    visitor.mockImplementation(() => {
      throw new Error("invalid payload");
    });
    await expect(identifyVisitor({ email: "ana@example.com" })).resolves.toBeUndefined();
    expect(visitor).toHaveBeenCalledWith({ email: "ana@example.com" }, {});
  });
});
