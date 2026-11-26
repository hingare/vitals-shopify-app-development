/**
 * ছোট্ট DOM সাহায্যকারী: ট্যাগ, স্টাইল, attribute আর ভেতরের জিনিস একবারে। early স্ক্রিপ্ট পাতার HTML-এ
 * inline যায় আর Shopify-র ১০০KB Liquid সীমায় গোনা হয়, তাই উইজেট বানানোর কোড এটা দিয়ে ছোট রাখা।
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css = "",
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (css) el.style.cssText = css;
  for (const name in attrs) el.setAttribute(name, attrs[name]!);
  el.append(...children);
  return el;
}
