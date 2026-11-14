const VARIABLE = /(\{[a-zA-Z_]+\})/;
const GLUE = /^[\s\-–—|,·•:;/]+$/;

/**
 * নিয়ম থেকে লেখা বানায়: "{product} | {shop}" ধরনের, মানগুলো `values` থেকে।
 * কোনো মান ফাঁকা হলে (যেমন vendor নেই) তার পাশের বিভাজকও বাদ যায়: "Shirt - - Shop" নয়, "Shirt - Shop"।
 * অচেনা {নাম} ফাঁকা ধরা হয়, যাতে বন্ধনীসহ লেখা কখনো স্টোরে না যায়।
 * মানের ভেতরের লেখা (যেমন "T-Shirt") কখনো বদলায় না। `max` অক্ষরের পর কাটা হয়।
 * SEO Alt Tags (ছবির alt) আর SEO Meta Templates (টাইটেল ও বর্ণনা) দুটোই এটা ব্যবহার করে।
 */
export function renderTemplate(
  template: string,
  values: Record<string, string | undefined>,
  max: number,
): string {
  const parts: Array<{ text: string; glue: boolean }> = [];
  let dropNextGlue = false;
  for (const piece of template.split(VARIABLE)) {
    if (!piece) continue;
    if (VARIABLE.test(piece)) {
      const name = piece.slice(1, -1);
      const value = (Object.hasOwn(values, name) ? (values[name] ?? "") : "").trim();
      if (value) {
        parts.push({ text: value, glue: false });
        dropNextGlue = false;
      } else if (parts[parts.length - 1]?.glue) {
        // ফাঁকা মানের আগের বিভাজক বাদ
        parts.pop();
      } else {
        // আগে বিভাজক নেই (শুরুতে): পরেরটা বাদ
        dropNextGlue = true;
      }
      continue;
    }
    const glue = GLUE.test(piece);
    if (glue && dropNextGlue) {
      dropNextGlue = false;
      continue;
    }
    dropNextGlue = false;
    parts.push({ text: piece, glue });
  }
  while (parts[0]?.glue) parts.shift();
  while (parts[parts.length - 1]?.glue) parts.pop();
  return parts
    .map((part) => part.text)
    .join("")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}
