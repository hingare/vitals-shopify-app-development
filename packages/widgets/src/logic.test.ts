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
