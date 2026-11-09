import { describe, expect, it } from "vitest";
import { deliveryWindow, formatDuration, offsetMinutes } from "./dates";
import { labelsFor } from "./labels";
import { currencyForLocale, parseMoney, replaceMoney } from "./money";
import { parseChart } from "./tools/size-chart";
import { parseRedirects } from "./tools/geolocation-redirect";
import { remember } from "./tools/recently-viewed";
import { links } from "./tools/quick-links";

const day = (d: Date) => d.toISOString().slice(0, 10);

describe("delivery dates", () => {
  const s = { minDays: 2, maxDays: 4, skipWeekends: true, cutoffHour: 14 };

  it("ships today before the cutoff and skips weekends", () => {
    // বৃহস্পতিবার ২০২৬-১১-১২, ঢাকায় সকাল ১০টা (+0600)
    const now = Date.parse("2026-11-12T04:00:00Z");
    const w = deliveryWindow(now, "+0600", s);
    expect(day(w.start)).toBe("2026-11-16"); // শুক্র, (শনি-রবি বাদ) সোম
    expect(day(w.end)).toBe("2026-11-18");
    expect(w.cutoffIn).toBe(4 * 3600_000);
  });

  it("ships the next working day after the cutoff", () => {
    // শুক্রবার বিকেল ৪টা ঢাকায়: সোমবার পাঠানো হবে
    const now = Date.parse("2026-11-13T10:00:00Z");
    const w = deliveryWindow(now, "+0600", s);
    expect(w.cutoffIn).toBeNull();
    expect(day(w.start)).toBe("2026-11-18");
  });

  it("reads time zone offsets and formats durations", () => {
    expect(offsetMinutes("+0530")).toBe(330);
    expect(offsetMinutes("-0800")).toBe(-480);
    expect(formatDuration(8_100_000)).toBe("2h 15m");
  });
});

describe("product labels", () => {
  const s = {
    showSale: true,
    saleText: "-{percent}%",
    showNew: true,
    newDays: 14,
    newText: "New",
    showSoldOut: true,
    soldOutText: "Sold out",
    customTag: "Eco",
    customText: "Eco",
  };
  const now = Date.parse("2026-11-09T00:00:00Z");

  it("shows sold out first and at most two labels", () => {
    expect(
      labelsFor(
        { price: 800, compareAt: 1000, available: false, tags: ["eco"], createdAt: "2026-11-08" },
        s,
        now,
      ),
    ).toEqual(["Sold out", "Eco"]);
  });

  it("computes the sale percent and the new window", () => {
    expect(labelsFor({ price: 800, compareAt: 1000, available: true }, s, now)).toEqual(["-20%"]);
    expect(labelsFor({ price: 800, available: true, createdAt: "2026-10-01" }, s, now)).toEqual([]);
  });
});

describe("money", () => {
  it("parses prices in the store's format", () => {
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("1.234,50 €", "{{amount_with_comma_separator}} €")).toBe(1234.5);
    expect(parseMoney("Tk 1,200")).toBe(1200);
    expect(parseMoney("Free")).toBeNull();
  });

  it("replaces only the price part of a text", () => {
    expect(replaceMoney("Total: $20.00 USD", "£16.00")).toBe("Total: £16.00");
    expect(replaceMoney("From Tk 1,200", "$11.00")).toBe("From $11.00");
  });

  it("picks a currency from the browser language", () => {
    expect(currencyForLocale("en-GB")).toBe("GBP");
    expect(currencyForLocale("de-DE")).toBe("EUR");
    expect(currencyForLocale("bn-BD")).toBe("BDT");
    expect(currencyForLocale("en")).toBeNull();
  });
});

describe("small parsers", () => {
  it("reads the size chart", () => {
    expect(parseChart("Size, Chest\n\nS, 34")).toEqual([
      ["Size", "Chest"],
      ["S", "34"],
    ]);
  });

  it("reads country redirect rules", () => {
    expect(
      parseRedirects("bd = https://bd.example.com\nbad line\nUS=https://us.example.com"),
    ).toEqual({
      BD: "https://bd.example.com",
      US: "https://us.example.com",
    });
  });

  it("keeps recently viewed unique, newest first, capped", () => {
    expect(remember(["a", "b", "c"], "b", 3)).toEqual(["b", "a", "c"]);
    expect(remember(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });

  it("keeps only quick links with text and a safe address", () => {
    expect(
      links({
        link1Label: "Track",
        link1Url: "/account",
        link2Label: "Bad",
        link2Url: "javascript:alert(1)",
        link3Label: "",
        link3Url: "/x",
      }),
    ).toEqual([{ label: "Track", url: "/account" }]);
  });
});

describe("offers on the storefront", async () => {
  const { offerShown, storeToday } = await import("./offers");
  const { giftStatus } = await import("./tools/free-gifts");
  const { bogoText } = await import("./tools/bogo");
  const config = { tzOffset: "+0600" } as Parameters<typeof offerShown>[1];
  // 2026-11-09 20:00 UTC = 10 Nov 02:00 in the store
  const now = Date.UTC(2026, 10, 9, 20, 0);

  it("checks dates in the store's time zone", () => {
    expect(storeToday(config, now)).toBe("2026-11-10");
    expect(offerShown({ startsOn: "2026-11-10" }, config, now)).toBe(true);
    expect(offerShown({ endsOn: "2026-11-09" }, config, now)).toBe(false);
    expect(offerShown(undefined, config, now)).toBe(true);
  });

  it("unlocks a gift without counting the gift's own price", () => {
    const gift = {
      id: "g",
      triggerProductIds: [],
      minQty: 1,
      variantId: "9",
      handle: "socks",
      title: "Socks",
      qty: 1,
      progressText: "",
      rules: { minSubtotal: 50 },
    };
    const item = (variant: number, cents: number) => ({
      key: String(variant),
      variant_id: variant,
      product_id: variant,
      quantity: 1,
      original_line_price: cents,
      final_line_price: cents,
    });
    expect(giftStatus(gift, [item(1, 3000), item(9, 4000)], 1)).toEqual({
      qualifies: false,
      remaining: 2000,
    });
    expect(giftStatus(gift, [item(1, 5000)], 1).qualifies).toBe(true);
    // ক্রেতার মুদ্রা দ্বিগুণ হলে ১০০ লাগবে
    expect(giftStatus(gift, [item(1, 5000)], 2).remaining).toBe(5000);
  });

  it("writes the BOGO offer", () => {
    const t = (k: "bogoFree" | "bogoOff") =>
      k === "bogoFree" ? "Buy {buy}, get {get} free" : "Buy {buy}, get {get} at {value} off";
    expect(bogoText({ buyQty: 2, getQty: 1, value: { percent: 100 } }, t, String)).toBe(
      "Buy 2, get 1 free",
    );
    expect(bogoText({ buyQty: 1, getQty: 1, value: { percent: 50 } }, t, String)).toBe(
      "Buy 1, get 1 at 50% off",
    );
  });
});
