/** Liquid app embed পেজে এই কনফিগ বসিয়ে দেয় (metafield থেকে), তাই কোনো API কল লাগে না। */
export interface StoreConfig {
  /** থিম এক্সটেনশনের assets ফোল্ডারের URL */
  assetBase: string;
  /** বর্তমান পেজের ধরন: product, collection, cart ... */
  pageType: string;
  locale: string;
  tools: Array<{ id: string; settings: Record<string, unknown> }>;
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
