import type { ToolContext } from "../types";

interface Settings {
  productSchema: boolean;
  organizationSchema: boolean;
  breadcrumbSchema: boolean;
  removeThemeDuplicates: boolean;
}

/** কোন schema ধরন আমাদের কোন সেটিং দিয়ে আসে */
const OWNER: Record<string, keyof Settings> = {
  Product: "productSchema",
  ProductGroup: "productSchema",
  Organization: "organizationSchema",
  OnlineStore: "organizationSchema",
  WebSite: "organizationSchema",
  BreadcrumbList: "breadcrumbSchema",
};

/** একটা JSON-LD স্ক্রিপ্টের ভেতরের সব @type (@graph আর তালিকাসহ); ভাঙা JSON হলে ফাঁকা */
export function schemaTypes(text: string): string[] {
  try {
    const data = JSON.parse(text) as unknown;
    const top = Array.isArray(data) ? data : [data];
    const items = top.flatMap((item) =>
      item && typeof item === "object" && Array.isArray((item as { "@graph"?: unknown })["@graph"])
        ? ((item as { "@graph": unknown[] })["@graph"] as unknown[])
        : [item],
    );
    return items.flatMap((item) => {
      const type =
        item && typeof item === "object" ? (item as { "@type"?: unknown })["@type"] : null;
      return (Array.isArray(type) ? type : [type]).filter(
        (t): t is string => typeof t === "string",
      );
    });
  } catch {
    return [];
  }
}

/**
 * থিমের স্ক্রিপ্টটা সরানো যাবে কিনা: এর প্রতিটা ধরন আমরাও এই পেজে দিচ্ছি (তাই কিছু হারায় না)।
 * অন্য কিছু (যেমন Article, FAQPage) মেশানো থাকলে রাখা হয়।
 */
export function isDuplicate(types: string[], ours: Set<string>, settings: Settings): boolean {
  return (
    types.length > 0 &&
    types.every((type) => ours.has(type) && OWNER[type] !== undefined && settings[OWNER[type]])
  );
}

/**
 * AI SEO Schema-র JSON-LD Liquid সার্ভারেই লেখে (app embed)। এই ছোট কোড শুধু "থিমের একই schema সরাও"
 * চালু থাকলে কাজ করে: থিমও Product বা Organization দিলে Google দুটো আলাদা প্রোডাক্ট দেখত, তাই থিমেরটা সরে।
 */
export function mount({ settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (!s.removeThemeDuplicates) return;
  const ours = new Set<string>();
  document
    .querySelectorAll('script[type="application/ld+json"][data-app-schema]')
    .forEach((el) => schemaTypes(el.textContent ?? "").forEach((type) => ours.add(type)));
  if (ours.size === 0) return;
  document
    .querySelectorAll('script[type="application/ld+json"]:not([data-app-schema])')
    .forEach((el) => {
      if (isDuplicate(schemaTypes(el.textContent ?? ""), ours, s)) el.remove();
    });
}
