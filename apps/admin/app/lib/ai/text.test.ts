import { describe, expect, it } from "vitest";
import { clip, htmlToText, richTextToHtml } from "./text";

describe("richTextToHtml", () => {
  it("turns headings, lists, paragraphs and bold text into HTML", () => {
    expect(
      richTextToHtml(
        "Soft **linen** shirt.\nMade to last.\n\n## Why you'll love it\n- Breathable\n- Easy care\n\n### Care\nWash cold.",
      ),
    ).toBe(
      [
        "<p>Soft <strong>linen</strong> shirt.<br>Made to last.</p>",
        "<h2>Why you&#39;ll love it</h2>",
        "<ul><li>Breathable</li><li>Easy care</li></ul>",
        "<h3>Care</h3>",
        "<p>Wash cold.</p>",
      ].join("\n"),
    );
  });

  it("never lets markup through", () => {
    const html = richTextToHtml('<script>alert(1)</script>\n- <img src=x onerror="steal()">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("htmlToText", () => {
  it("keeps the words and drops scripts and tags", () => {
    expect(
      htmlToText("<p>Hello&nbsp;<b>world</b></p><script>x()</script><ul><li>A</li><li>B</li></ul>"),
    ).toBe("Hello world\nA\nB");
  });
});

describe("clip", () => {
  it("cuts at a word boundary", () => {
    expect(clip("Organic cotton t-shirt for summer days", 20)).toBe("Organic cotton");
    expect(clip("short", 20)).toBe("short");
  });
});
