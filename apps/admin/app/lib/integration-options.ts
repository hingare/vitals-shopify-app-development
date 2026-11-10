/** ব্রাউজারেও নিরাপদ (অ্যাডমিন পেজের ফর্ম আর সার্ভার দুটোই ব্যবহার করে) */

/** কোন কোন জায়গা থেকে গ্রাহক আসে; প্রতিটার জন্য মার্চেন্ট আলাদা লিস্ট বাছতে পারেন */
export const SYNC_SOURCES = ["shopify", "popup", "spin-wheel", "back-in-stock", "review"] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

/** লিস্টের মান: "" = ডিফল্ট লিস্ট, "-" = এই উৎস থেকে পাঠানো হবে না, নইলে লিস্টের id */
export const SKIP_LIST = "-";
