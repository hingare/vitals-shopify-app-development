/** সার্ভার ও অ্যাডমিন পেজ দুই জায়গায় লাগে, তাই .server ফাইলের বাইরে */
export const REVIEW_STATUSES = ["pending", "published", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** এক CSV ফাইলে সর্বোচ্চ কতগুলো রিভিউ ইমপোর্ট হবে */
export const MAX_IMPORT_ROWS = 10_000;
