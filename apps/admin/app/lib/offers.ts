/** সার্ভার ও অ্যাডমিন পেজ দুই জায়গায় লাগে, তাই .server ফাইলের বাইরে */
export const OFFER_TYPES = ["volume", "bundle", "gift", "bogo", "upsell"] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

/** কোন ক্রেতাদের জন্য অফার */
export const AUDIENCES = ["all", "new", "returning", "loggedIn"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** একই প্রোডাক্টে একাধিক অফার মিললে কোনটা বসবে */
export const CONFLICT_MODES = ["best", "priority"] as const;
export type ConflictMode = (typeof CONFLICT_MODES)[number];

/** A/B টেস্টের গ্রুপ ("" = সবাই) */
export const AB_GROUPS = ["", "A", "B"] as const;
export type AbGroup = (typeof AB_GROUPS)[number];

/** স্টোরফ্রন্ট এই cart attribute-এ ক্রেতার A/B গ্রুপ রাখে, চেকআউটের function পড়ে */
export const AB_ATTRIBUTE = "_app_ab";

/** অফারের ছাড়ের লেবেল ডিফল্ট (মার্চেন্ট বদলাতে পারেন; রিপোর্টে অফার চেনা হয় এই লেবেল দিয়ে) */
export const DEFAULT_LABELS: Record<OfferType, string> = {
  volume: "Buy more, save",
  bundle: "Bundle discount",
  gift: "Free gift",
  bogo: "Buy more, get more",
  upsell: "Special offer",
};

/** Upsell কোথায় দেখাবে */
export const UPSELL_PLACEMENTS = ["popup", "product", "cart"] as const;
export type UpsellPlacement = (typeof UPSELL_PLACEMENTS)[number];
