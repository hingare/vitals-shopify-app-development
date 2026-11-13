import { describe, expect, it } from "vitest";
import {
  FLOWS,
  FLOW_KEYS,
  emailContentSchema,
  emailSettingsSchema,
  fillContent,
  fillVars,
  flowContentSchema,
  readEmailSettings,
  renderEmail,
} from "./email-template";

const content = emailContentSchema.parse({
  subject: "Hi {first_name}",
  heading: "Sale <now>",
  body: "First line\nsecond line\n\nNew paragraph & more",
  buttonText: "Shop",
  buttonUrl: "https://shop.com/sale?a=1&b=2",
});
const frame = { shopName: "Tom & Co", accent: "#111827", postalAddress: "1 Road\nDhaka" };

describe("fillVars", () => {
  it("fills known names and leaves unknown ones as written", () => {
    expect(fillVars("Hi {first_name}, {unknown}", { first_name: "Rahim" })).toBe(
      "Hi Rahim, {unknown}",
    );
  });

  it("never touches link fields", () => {
    const filled = fillContent(
      { subject: "{shop}", buttonUrl: "https://x.com/{shop}" },
      { shop: "Tom" },
    );
    expect(filled).toEqual({ subject: "Tom", buttonUrl: "https://x.com/{shop}" });
  });
});

describe("content rules", () => {
  it("needs a subject and only allows https links", () => {
    expect(emailContentSchema.safeParse({ subject: "" }).success).toBe(false);
    expect(
      emailContentSchema.safeParse({ subject: "x", buttonUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(emailContentSchema.safeParse({ subject: "x", buttonUrl: "http://a.com" }).success).toBe(
      false,
    );
    expect(emailContentSchema.safeParse({ subject: "x", buttonUrl: "" }).success).toBe(true);
  });

  it("falls back to safe sender settings", () => {
    expect(readEmailSettings({ accent: "red" }).accent).toBe("#111827");
    expect(emailSettingsSchema.safeParse({ replyTo: "not-an-email" }).success).toBe(false);
  });

  it("has valid default content for every flow", () => {
    for (const key of FLOW_KEYS) {
      expect(flowContentSchema.safeParse(FLOWS[key].content).success).toBe(true);
      expect(FLOWS[key].delayMinutes).toBeGreaterThanOrEqual(FLOWS[key].minDelay);
      expect(FLOWS[key].delayMinutes).toBeLessThanOrEqual(FLOWS[key].maxDelay);
    }
  });
});

describe("renderEmail", () => {
  it("escapes everything the merchant or shopper typed", () => {
    const { html } = renderEmail(content, frame);
    expect(html).toContain("Sale &lt;now&gt;");
    expect(html).toContain("New paragraph &amp; more");
    expect(html).toContain("Tom &amp; Co");
    expect(html).not.toContain("<now>");
    expect(html).toContain("First line<br>second line");
  });

  it("puts the unsubscribe link in marketing emails, in both HTML and text", () => {
    const { html, text } = renderEmail(content, {
      ...frame,
      unsubscribeUrl: "https://app.test/e/u/tok",
    });
    expect(html).toContain('href="https://app.test/e/u/tok"');
    expect(text).toContain("Unsubscribe: https://app.test/e/u/tok");
    expect(text).toContain("1 Road\nDhaka");
  });

  it("leaves it out of transactional emails", () => {
    const { html, text } = renderEmail(content, frame);
    expect(html).not.toContain("Unsubscribe");
    expect(text).not.toContain("Unsubscribe");
  });

  it("wraps the button link for click counting and adds the open pixel", () => {
    const { html, text } = renderEmail(content, {
      ...frame,
      openPixelUrl: "https://app.test/e/o/m1.sig",
      wrapLink: (url) => `https://app.test/e/c/m1?u=${encodeURIComponent(url)}`,
    });
    expect(html).toContain("https://app.test/e/c/m1?u=https%3A%2F%2Fshop.com%2Fsale");
    expect(html).toContain('src="https://app.test/e/o/m1.sig"');
    // লেখা সংস্করণে আসল লিংকই থাকে
    expect(text).toContain("Shop: https://shop.com/sale?a=1&b=2");
  });

  it("shows no button without both a label and a link", () => {
    const { html } = renderEmail({ ...content, buttonUrl: "" }, frame);
    expect(html).not.toContain("<a href");
  });
});
