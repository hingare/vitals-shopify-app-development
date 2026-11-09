/** Liquid app embed পেজে এই কনফিগ বসিয়ে দেয় (metafield থেকে), তাই কোনো API কল লাগে না। */
export interface StoreConfig {
  /** থিম এক্সটেনশনের assets ফোল্ডারের URL */
  assetBase: string;
  /** বর্তমান পেজের ধরন: product, collection, cart ... */
  pageType: string;
  locale: string;
  /** কার্টের মুদ্রা (দাম দেখানোর জন্য) */
  currency?: string;
  tools: Array<{ id: string; settings: Record<string, unknown> }>;
  /** Volume Discount আর Bundle অফার (app_config.offers metafield থেকে) */
  offers?: StoreOffers | null;
}

export interface OfferValue {
  percent?: number;
  amountEach?: number;
}

export interface StoreOffers {
  volume: Array<{
    id: string;
    /** খালি মানে সব প্রোডাক্ট */
    productIds: string[];
    tiers: Array<{ minQty: number; value: OfferValue }>;
  }>;
  bundles: Array<{
    id: string;
    title: string;
    value: OfferValue;
    items: Array<{ productId: string; handle: string; qty: number }>;
  }>;
}

export interface ToolContext {
  config: StoreConfig;
  settings: Record<string, unknown>;
}

export type ToolModule = { mount: (ctx: ToolContext) => void | Promise<void> };

declare global {
  interface Window {
    __APP_CONFIG__?: StoreConfig;
  }
}
