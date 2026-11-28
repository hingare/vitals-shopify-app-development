/**
 * Wishlist-এর "Add to wishlist" বাটন। early.ts পাতা আঁকার আগেই বসায়, ব্রাউজারে রাখা তালিকা দেখে আসল অবস্থায়
 * (টুলের ফাইল আসার আগে চাপলে সেই চাপ পরে কাজ করে, তাই ভুল অবস্থা দেখালে উল্টো কাজ হত); টুলের ফাইল পরে এসে
 * চাপার কাজ জুড়ে দেয় আর সার্ভারের তালিকা এলে সেটা দেখায়।
 */
import { store } from "../dom";
import { outlinedButton } from "./button";
import { h, icon } from "./h";

/** ব্রাউজারে রাখা তালিকা (টুলের ফাইলও এটাই পড়ে আর লেখে) */
export const CACHE_KEY = "app_wishlist";

export interface WishlistItem {
  productId: string;
  handle: string;
}

export const isItem = (value: unknown): value is WishlistItem => {
  const item = value as WishlistItem | null;
  return (
    Boolean(item) &&
    typeof item === "object" &&
    typeof item?.productId === "string" &&
    typeof item.handle === "string"
  );
};

/**
 * ব্রাউজারে রাখা তালিকা পড়ে। তালিকাটা কার (`o`: ক্রেতার id, অতিথির জন্য ০) তা সাথে লেখা থাকে:
 * ক্রেতা লগআউট করলে বা অন্য ক্রেতা লগইন করলে আগের জনের তালিকা আর দেখানো হয় না।
 * অতিথির তালিকা লগইনের পরেও দেখায়, কারণ সার্ভার সেটা ক্রেতার তালিকায় মিশিয়ে দেয়।
 */
export function readCache(raw: string | null, customerId: number | null): WishlistItem[] {
  try {
    const cache = JSON.parse(raw ?? "null") as { o?: unknown; items?: unknown } | null;
    if (!cache || !Array.isArray(cache.items)) return [];
    const owner = typeof cache.o === "number" ? cache.o : 0;
    if (owner !== 0 && owner !== (customerId ?? 0)) return [];
    return cache.items.filter(isItem);
  } catch {
    return [];
  }
}

/** এই প্রোডাক্ট ব্রাউজারে রাখা তালিকায় আছে কিনা */
export const isSaved = (productId: string, customerId: number | null) =>
  readCache(store.get(CACHE_KEY), customerId).some((item) => item.productId === productId);

export interface SaveSettings {
  addText: string;
  addedText: string;
  colors: { background: string; text: string; accent: string };
}

const HEART =
  '<path d="M12 20.5 4.2 12.7a4.9 4.9 0 0 1 6.9-6.9l.9.9.9-.9a4.9 4.9 0 0 1 6.9 6.9z"/>';

export function heart(filled: boolean): SVGSVGElement {
  return icon(
    20,
    {
      fill: filled ? "currentColor" : "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linejoin": "round",
    },
    HEART,
  );
}

export function buildSave(s: SaveSettings, saved: boolean): HTMLElement {
  return h(
    "div",
    "margin:12px 0",
    {},
    h(
      "button",
      `${outlinedButton(s.colors.accent)};width:100%;display:flex;gap:8px;align-items:center;justify-content:center`,
      { type: "button", "aria-pressed": String(saved) },
      h("span", `color:${s.colors.accent};display:flex`, {}, heart(saved)),
      saved ? s.addedText : s.addText,
    ),
  );
}
