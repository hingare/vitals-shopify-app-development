/** Liquid app embed পেজে এই কনফিগ বসিয়ে দেয় (metafield থেকে), তাই কোনো API কল লাগে না। */
export interface StoreConfig {
  /** থিম এক্সটেনশনের assets ফোল্ডারের URL */
  assetBase: string;
  /** বর্তমান পেজের ধরন: product, collection, cart ... */
  pageType: string;
  locale: string;
  /** কার্টের মুদ্রা (দাম দেখানোর জন্য) */
  currency?: string;
  /** স্টোরের টাইমজোন, যেমন "+0600" */
  tzOffset?: string;
  /** স্টোরের মূল মুদ্রা ও দাম লেখার ধরন (Currency Converter) */
  shopCurrency?: string;
  moneyFormat?: string;
  /** Shopify Markets-এ চালু মুদ্রার সংখ্যা (১-এর বেশি হলে Markets নিজেই রূপান্তর করে) */
  marketsCurrencies?: number;
  /** বর্তমান দেশ আর Markets-এ চালু দেশগুলো (Geolocation Redirect) */
  country?: string;
  countries?: string[];
  tools: Array<{ id: string; settings: Record<string, unknown> }>;
  /** মার্চেন্ট নিজে উইজেটের জায়গা ঠিক করলে (না করলে উইজেট নিজেই খুঁজে নেয়) */
  placement?: {
    productAnchor: string;
    productWhere: "after" | "before";
    cartAnchor: string;
    cartWhere: "after" | "before";
  } | null;
  /** Volume Discount আর Bundle অফার (app_config.offers metafield থেকে) */
  offers?: StoreOffers | null;
}

export interface OfferValue {
  percent?: number;
  amountEach?: number;
}

/** স্টোরফ্রন্টে যতটুকু যাচাই করা যায়; ক্রেতা বা দেশের শর্ত চেকআউটে যাচাই হয় */
export interface OfferRules {
  startsOn?: string;
  endsOn?: string;
  abGroup?: "" | "A" | "B";
  /** স্টোরের মূল মুদ্রায় */
  minSubtotal?: number;
  restricted?: boolean;
}

export interface StoreOffers {
  volume: Array<{
    id: string;
    /** খালি মানে সব প্রোডাক্ট */
    productIds: string[];
    tiers: Array<{ minQty: number; value: OfferValue }>;
    rules?: OfferRules;
  }>;
  bundles: Array<{
    id: string;
    title: string;
    value: OfferValue;
    items: Array<{ productId: string; handle: string; qty: number }>;
    rules?: OfferRules;
  }>;
  gifts?: Array<{
    id: string;
    /** খালি = যেকোনো প্রোডাক্ট */
    triggerProductIds: string[];
    minQty: number;
    variantId: string;
    handle: string;
    title: string;
    qty: number;
    progressText: string;
    rules?: OfferRules;
  }>;
  bogo?: Array<{
    id: string;
    buyProductIds: string[];
    buyQty: number;
    getProductIds: string[];
    getQty: number;
    value: OfferValue;
    rules?: OfferRules;
  }>;
  upsells?: Array<{
    id: string;
    /** খালি = যেকোনো প্রোডাক্ট */
    triggerProductIds: string[];
    products: Array<{ id: string; handle: string }>;
    /** ছাড় না থাকলে null */
    value: OfferValue | null;
    title: string;
    placements: Array<"popup" | "product" | "cart">;
    rules?: OfferRules;
  }>;
  /** কোনো অফার A/B টেস্টে আছে কিনা */
  ab?: boolean;
}

export interface ToolContext {
  config: StoreConfig;
  settings: Record<string, unknown>;
}

export type ToolModule = { mount: (ctx: ToolContext) => void | Promise<void> };

declare global {
  interface Window {
    __APP_CONFIG__?: StoreConfig;
    Shopify?: {
      currency?: { active?: string; rate?: string };
      routes?: { root?: string };
      loadFeatures?: (
        features: Array<{ name: string; version: string }>,
        callback: (error?: unknown) => void,
      ) => void;
      customerPrivacy?: {
        shouldShowBanner?: () => boolean;
        currentVisitorConsent?: () => Record<string, string>;
        setTrackingConsent: (consent: Record<string, boolean>, callback: () => void) => void;
      };
    };
  }
}
