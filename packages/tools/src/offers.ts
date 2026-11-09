import { defineTool, themeColors, z } from "@app/tool-sdk";

/**
 * Volume Discounts: একই প্রোডাক্ট বেশি কিনলে বেশি ছাড়।
 * অফারগুলো অ্যাপের Offers পেজে বানানো হয়; এই টুল চালু থাকলে চেকআউটে ছাড় বসে
 * আর প্রোডাক্ট পেজে ছাড়ের টেবিল দেখায়।
 */
export const volumeDiscounts = defineTool({
  id: "volume-discounts",
  category: "upsell",
  plan: "starter",
  surfaces: ["product", "cart", "checkout"],
  delivery: "function",
  settings: z.object({
    showTable: z.boolean().default(true),
    colors: themeColors(),
  }),
  attribution: ["view", "click", "add_to_cart"],
});

/** Product Bundles: কয়েকটা প্রোডাক্ট একসাথে কিনলে ছাড় ("একসাথে কিনুন" বক্স) */
export const bundles = defineTool({
  id: "bundles",
  category: "upsell",
  plan: "starter",
  surfaces: ["product", "cart", "checkout"],
  delivery: "function",
  settings: z.object({
    colors: themeColors(),
  }),
  attribution: ["view", "click", "add_to_cart"],
});

/**
 * Free Gifts: শর্ত পূরণ হলে (যেমন নির্দিষ্ট টাকার কেনাকাটা) একটা প্রোডাক্ট ফ্রি।
 * স্টোরফ্রন্ট গিফটটা নিজে কার্টে যোগ করে, আর চেকআউট function সত্যিই ফ্রি হলে তবেই রাখে।
 */
export const freeGifts = defineTool({
  id: "free-gifts",
  category: "upsell",
  plan: "starter",
  surfaces: ["all", "cart", "checkout"],
  delivery: "function",
  settings: z.object({
    autoAdd: z.boolean().default(true),
    showProgress: z.boolean().default(true),
    colors: themeColors(),
  }),
  attribution: ["view", "add_to_cart"],
});

/** Buy X Get Y (BOGO): কয়েকটা কিনলে পরেরটা ফ্রি বা ছাড়ে */
export const bogo = defineTool({
  id: "bogo",
  category: "upsell",
  plan: "starter",
  surfaces: ["product", "cart", "checkout"],
  delivery: "function",
  settings: z.object({
    showBadge: z.boolean().default(true),
    colors: themeColors(),
  }),
  attribution: ["view", "add_to_cart"],
});

/** কোন টুল কোন ধরনের অফার চালায় */
export const OFFER_TOOL_BY_TYPE = {
  volume: volumeDiscounts.id,
  bundle: bundles.id,
  gift: freeGifts.id,
  bogo: bogo.id,
} as const;
