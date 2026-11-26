import { registry } from "@app/tools";
import type { PageKind, StoreOptions } from "./store";

/**
 * প্রতিটা স্টোরফ্রন্ট টুল কোন পাতায়, কোন সেটিংসে দেখা যায়, আর দেখা গেলে কোন উপাদান থাকে।
 * সেটিংস না দিলে টুলের ডিফল্ট (মার্চেন্ট প্রথমবার চালু করলে যা পায়)।
 */
export interface Scenario {
  page: PageKind;
  settings?: Record<string, unknown>;
  store?: Omit<StoreOptions, "tools" | "page">;
  /** টুল চললে এটা পাতায় দেখা যায়; null = চোখে দেখার কিছু নেই (যেমন favicon বা title বদল) */
  expect: string | null;
}

/** সব অফার টুলের জন্য একই অফার: টি-শার্টে ভলিউম ছাড়, বান্ডেল, উপহার, BOGO আর আপসেল */
export const OFFERS = {
  volume: [
    {
      id: "v1",
      productIds: [],
      tiers: [
        { minQty: 2, value: { percent: 10 } },
        { minQty: 3, value: { percent: 15 } },
      ],
    },
  ],
  bundles: [
    {
      id: "b1",
      title: "Tee and mug",
      value: { percent: 10 },
      items: [
        { productId: "1001", handle: "cotton-tee", qty: 1 },
        { productId: "1002", handle: "coffee-mug", qty: 1 },
      ],
    },
  ],
  gifts: [
    {
      id: "g1",
      triggerProductIds: [],
      minQty: 1,
      variantId: "441",
      handle: "wool-socks",
      title: "Wool socks",
      qty: 1,
      progressText: "",
    },
  ],
  bogo: [
    {
      id: "o1",
      buyProductIds: ["1001"],
      buyQty: 2,
      getProductIds: ["1001"],
      getQty: 1,
      value: { percent: 100 },
    },
  ],
  upsells: [
    {
      id: "u1",
      triggerProductIds: [],
      products: [
        { id: "1003", handle: "canvas-cap" },
        { id: "1004", handle: "wool-socks" },
      ],
      value: { percent: 10 },
      title: "Complete the look",
      placements: ["popup", "product", "cart"],
    },
  ],
};

const inCart = [{ variant_id: 111, quantity: 1 }];
const after = (id: string) => `[data-app-widget="${id}"] > *`;
const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

export const SCENARIOS: Record<string, Scenario> = {
  "sticky-atc": { page: "product", expect: "#app-sticky-atc > *" },
  "product-reviews": { page: "product", expect: "#app-product-reviews h2" },
  "volume-discounts": {
    page: "product",
    store: { offers: OFFERS },
    expect: after("volume-discounts"),
  },
  bundles: { page: "product", store: { offers: OFFERS }, expect: after("bundles") },
  "free-gifts": { page: "product", store: { offers: OFFERS, cart: inCart }, expect: null },
  bogo: { page: "product", store: { offers: OFFERS }, expect: after("bogo") },
  upsells: { page: "product", store: { offers: OFFERS }, expect: after("upsells") },
  "cart-drawer": { page: "product", expect: '[data-app-widget="cart-drawer"]' },
  "cart-notice": { page: "cart", store: { cart: inCart }, expect: after("cart-notice") },
  "accelerated-checkout": {
    page: "product",
    expect: 'button[data-app-widget="accelerated-checkout"]',
  },
  "pre-orders": {
    page: "product",
    store: {
      product: { variantId: 112, available: true, inventory: { "111": 4 }, preorder: [112] },
    },
    expect: after("pre-orders"),
  },
  "spending-goal": { page: "product", expect: after("spending-goal") },
  "trust-seals": { page: "product", expect: after("trust-seals") },
  "payment-logos": { page: "product", expect: `${after("payment-logos")} svg` },
  "announcement-bar": { page: "product", expect: after("announcement-bar") },
  "countdown-timer": {
    page: "product",
    settings: { endDate: soon },
    expect: after("countdown-timer"),
  },
  "stock-scarcity": { page: "product", expect: after("stock-scarcity") },
  "chat-button": {
    page: "product",
    settings: { contact: "+8801700000000" },
    expect: "#app-chat-button a",
  },
  popup: { page: "product", settings: { delaySeconds: 0 }, expect: "#app-popup [role=dialog]" },
  "scroll-to-top": { page: "product", expect: null },
  "inactive-tab-message": { page: "product", expect: null },
  "content-protection": { page: "product", expect: null },
  "animated-atc": { page: "product", expect: null },
  "social-buttons": { page: "product", expect: after("social-buttons") },
  "auto-external-links": { page: "product", expect: null },
  "favicon-cart-count": { page: "product", store: { cart: inCart }, expect: null },
  "shipping-info": { page: "product", expect: after("shipping-info") },
  "recent-sales": {
    page: "product",
    settings: { firstDelaySeconds: 2 },
    expect: "#app-recent-sales > *",
  },
  "product-labels": { page: "product", expect: ".app-label span" },
  "description-tabs": { page: "product", expect: "[data-app-tabs] > *" },
  "size-chart": { page: "product", expect: `${after("size-chart")}` },
  "related-products": { page: "product", expect: after("related-products") },
  "recently-viewed": {
    page: "product",
    store: { storage: { app_recently_viewed: JSON.stringify(["coffee-mug", "canvas-cap"]) } },
    expect: after("recently-viewed"),
  },
  "quick-links": { page: "product", expect: "#app-quick-links button" },
  "hide-dynamic-checkout": { page: "product", expect: null },
  "agree-to-terms": {
    page: "cart",
    store: { cart: inCart },
    expect: ".app-terms input[type=checkbox]",
  },
  "currency-converter": { page: "product", expect: '[data-app-widget="currency"] select' },
  "cookies-banner": { page: "product", expect: "#app-cookies-banner > *" },
  "geolocation-redirect": { page: "product", expect: "[role=dialog]" },
  "push-notifications": {
    page: "product",
    settings: { delaySeconds: 0 },
    expect: "#app-push-prompt > *",
  },
  "back-in-stock": {
    page: "product",
    store: { product: { variantId: 112, available: false, priceCents: 2500 } },
    expect: after("back-in-stock"),
  },
  "spin-wheel": {
    page: "product",
    settings: { delaySeconds: 0 },
    expect: "#app-spin-wheel [role=dialog]",
  },
  wishlist: { page: "product", expect: after("wishlist") },
  "order-tracker": { page: "product", expect: 'a[data-app-widget="order-tracker"]' },
  "eu-withdrawal": { page: "product", expect: 'a[data-app-widget="eu-withdrawal"]' },
  "best-sellers-protection": { page: "collection", expect: null },
  "visitor-recordings": { page: "product", expect: null },
  "live-chat": { page: "product", expect: "#app-live-chat button" },
  "instant-search": { page: "product", expect: null },
  "ai-seo-schema": { page: "product", expect: null },
  "ai-product-faq": { page: "product", expect: "#app-ai-faq-host details" },
};

/** রেজিস্ট্রির যে টুলগুলো দোকানের পাতায় চলে (অ্যাডমিন বা web pixel-এর টুল বাদ) */
export const STOREFRONT_TOOLS = registry.all
  .filter((tool) => tool.delivery !== "admin" && tool.delivery !== "pixel")
  .map((tool) => tool.id);
