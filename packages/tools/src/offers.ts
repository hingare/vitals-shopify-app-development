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

/** কোন টুল কোন ধরনের অফার চালায় */
export const OFFER_TOOL_BY_TYPE = {
  volume: volumeDiscounts.id,
  bundle: bundles.id,
} as const;
