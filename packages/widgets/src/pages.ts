/**
 * যে টুলগুলো শুধু কয়েক ধরনের পাতায় কিছু করে (Shopify-র request.page_type)। লোডার অন্য পাতায় এদের
 * ফাইল আনেই না: হোম আর কালেকশন পাতায় কম অনুরোধ আর কম CPU। টুলের mount নিজেও একই পাতা দেখে থামে।
 *
 * এখানে শুধু সেই টুল, যার mount পাতা দেখার আগে কিছুই করে না (যেমন bundles, volume-discounts, bogo
 * সব পাতায় A/B দল মেলায়, তাই নেই)। কোনো টুল অন্য পাতায়ও কাজ শুরু করলে এখান থেকে সরান বা পাতা যোগ
 * করুন: e2e/tools.e2e.ts দেখে যে তালিকার বাইরের পাতায় টুলটা সত্যিই কিছু করে না।
 */
export const ONLY_ON: Readonly<Record<string, readonly string[]>> = {
  "accelerated-checkout": ["product"],
  "ai-product-faq": ["product"],
  "animated-atc": ["product"],
  "back-in-stock": ["product"],
  "countdown-timer": ["product"],
  "description-tabs": ["product"],
  "pre-orders": ["product"],
  "related-products": ["product"],
  "shipping-info": ["product"],
  "size-chart": ["product"],
  "social-buttons": ["product"],
  "sticky-atc": ["product"],
  "stock-scarcity": ["product"],
  "trust-seals": ["product", "cart"],
  "cart-notice": ["cart"],
  "best-sellers-protection": ["collection"],
};

/** এই পাতায় টুলটার ফাইল আনা দরকার কিনা */
export const runsOn = (tool: string, pageType: string) => ONLY_ON[tool]?.includes(pageType) ?? true;
