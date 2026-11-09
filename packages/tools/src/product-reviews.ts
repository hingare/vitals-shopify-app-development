import { defineTool, z } from "@app/tool-sdk";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * প্রোডাক্ট রিভিউ: প্রোডাক্ট পেজে রিভিউ তালিকা ও লেখার ফর্ম।
 * রেটিং Shopify-র স্ট্যান্ডার্ড metafield (reviews.rating, reviews.rating_count)-এ সেভ হয়,
 * তাই থিম নিজেই প্রোডাক্ট কার্ডে স্টার দেখাতে পারে আর Google rich result পায়।
 */
export const productReviews = defineTool({
  id: "product-reviews",
  category: "reviews",
  plan: "starter",
  // প্রোডাক্ট পেজে প্রোডাক্ট রিভিউ; "Store reviews" ব্লক দিয়ে যেকোনো পেজে স্টোর রিভিউ
  surfaces: ["product", "all"],
  delivery: "block",
  settings: z.object({
    /** নতুন রিভিউ কখন নিজে থেকে প্রকাশ হবে: none = সব হাতে অনুমোদন */
    autoPublish: z.enum(["none", "4plus", "all"]).default("4plus"),
    perPage: z.number().int().min(3).max(20).default(5),
    showForm: z.boolean().default(true),
    /** ক্রেতা রিভিউর সাথে ৩টা পর্যন্ত ছবি দিতে পারবেন (মার্চেন্টের Shopify Files-এ থাকে) */
    allowPhotos: z.boolean().default(true),
    starColor: hex.default("#F5A623"),
  }),
  attribution: ["view"],
});
