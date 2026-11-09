/**
 * স্টোরে ক্রেতারা যে লেখা দেখে। এখন শুধু ইংরেজি।
 * নতুন ভাষা: নিচে একটা ব্লক যোগ করুন (যেমন `bn: { addToCart: "কার্টে যোগ করুন", ... }`)।
 * স্টোরের ভাষা (request.locale) মিলে গেলে সেটাই দেখাবে, না মিললে ইংরেজি।
 */
const strings = {
  en: {
    addToCart: "Add to cart",
    added: "Added",
    soldOut: "Sold out",
    reviews: "Customer reviews",
    review: "review",
    reviewsCount: "reviews",
    noReviews: "No reviews yet. Be the first to write one.",
    writeReview: "Write a review",
    yourRating: "Your rating",
    chooseRating: "Please choose a star rating.",
    name: "Name",
    email: "Email (not shown publicly)",
    reviewTitle: "Title (optional)",
    reviewBody: "Your review",
    submitReview: "Submit review",
    sendFailed: "Could not send your review. Please try again.",
    duplicate: "You already reviewed this product today.",
    thanksPublished: "Thank you! Your review is now live.",
    thanksPending: "Thank you! Your review will appear after approval.",
    verified: "Verified buyer",
    storeReply: "Store reply",
    showMore: "Show more reviews",
  },
} satisfies Record<string, Record<string, string>>;

export type WidgetString = keyof (typeof strings)["en"];

export function widgetT(locale: string, key: WidgetString): string {
  const base = locale.toLowerCase().split("-")[0] ?? "en";
  const dict = (strings as Record<string, Partial<Record<WidgetString, string>>>)[base];
  return dict?.[key] ?? strings.en[key];
}
