/** সার্ভার ও অ্যাডমিন পেজ দুই জায়গায় লাগে, তাই .server ফাইলের বাইরে */
export const OFFER_TYPES = ["volume", "bundle"] as const;
export type OfferType = (typeof OFFER_TYPES)[number];
