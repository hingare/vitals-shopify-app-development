/** সার্ভার ও অ্যাডমিন পেজ দুই জায়গায় লাগে, তাই .server ফাইলের বাইরে */
export const REVIEW_STATUSES = ["pending", "published", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
