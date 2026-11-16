/**
 * AI কখনো HTML লেখে না: লেখে সাধারণ লেখা, ছোট কয়েকটা চিহ্নসহ। আমরা সেটা থেকে নিজেরা HTML বানাই,
 * প্রতিটা অক্ষর escape করে, তাই কোনো পেজের লেখা বা প্রম্পট দিয়ে স্টোরে স্ক্রিপ্ট ঢোকানো যায় না।
 *   "## শিরোনাম" / "### ছোট শিরোনাম"  →  <h2> / <h3>
 *   "- বিষয়" (পরপর লাইন)               →  <ul><li>…</li></ul>
 *   ফাঁকা লাইনে আলাদা অনুচ্ছেদ          →  <p>…</p>
 *   **মোটা লেখা**                        →  <strong>…</strong>
 * মার্চেন্ট অ্যাডমিনে এই লেখাই বদলান, তাই নিয়মগুলো সহজ রাখা হয়েছে।
 */
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const inline = (value: string) =>
  escapeHtml(value.trim()).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

export function richTextToHtml(text: string): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length)
      out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const raw of text.replaceAll("\r\n", "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    const bullet = /^[-•*]\s+(.+)$/.exec(line);
    if (!line) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1] === "##" ? "h2" : "h3";
      out.push(`<${level}>${inline(heading[2] ?? "")}</${level}>`);
    } else if (bullet) {
      flushParagraph();
      list.push(bullet[1] ?? "");
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return out.join("\n");
}

/** HTML থেকে সাধারণ লেখা (প্রম্পটে পাঠানোর জন্য; ট্যাগ বাদ, জায়গা ছোট) */
export function htmlToText(html: string, max = 4_000): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, max);
}

/** লেখা নির্দিষ্ট দৈর্ঘ্যে কাটে, শব্দের মাঝখানে নয় */
export function clip(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}
