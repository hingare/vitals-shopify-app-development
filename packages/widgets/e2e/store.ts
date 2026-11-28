import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { Liquid, type Context } from "liquidjs";
import { buildStoreConfig, registry } from "@app/tools";
import { formatShopMoney } from "../src/money";
import { HERO, SERVER_MS, WEIGHT_ASSETS, weightChrome, weightHead } from "./weight";

/**
 * পরীক্ষার জন্য নকল Shopify দোকান: Dawn-এর মতো একটা পাতা, Shopify-র Ajax API (/cart.js,
 * /products/x.js ...) আর আমাদের App Proxy-র (/apps/app-tools/*) নকল উত্তর। উইজেটগুলো চলে আসল
 * বিল্ড করা ফাইল থেকে (theme-embed/assets), ঠিক যেমন দোকানে চলে। ইন্টারনেট বা আসল দোকান লাগে না।
 * app embed-এর Liquid-ও আসলটাই (liquidjs দিয়ে), দোকানের মতো <head>-এ।
 */
export const ORIGIN = "https://shop.test";
/** থিম এক্সটেনশনের ফোল্ডার (blocks, snippets, assets) */
export const THEME = fileURLToPath(
  new URL("../../../apps/admin/extensions/theme-embed/", import.meta.url),
);
/** বিল্ড করা উইজেটের ফাইল (loader.js, tool-*.js) */
export const ASSETS = `${THEME}assets/`;

/** Shopify-র নিজস্ব ফিল্টারগুলো এখানে সাধারণ নকল; বাকিগুলো liquidjs-এরই */
const liquid = new Liquid({
  root: [`${THEME}snippets`, `${THEME}blocks`],
  extname: ".liquid",
  timezoneOffset: "Asia/Dhaka",
});
/** ফিল্টারের ভেতর থেকে পাতার global পড়া (liquidjs ফিল্টারকে this.context দেয়) */
type Filter = { context: Context };
// পথগুলো দোকানের নিজের ঠিকানার সাপেক্ষে, যাতে Playwright-এর shop.test আর আসল সার্ভার (serveStore) দুটোতেই চলে।
// asset_base Shopify-র global নয়: আসল থিমের পরীক্ষা (e2e/themes.ts) আমাদের ফাইল অন্য পথে দেয়
liquid.registerFilter("asset_url", function (this: Filter, file: string) {
  const base = this.context.getSync(["asset_base"]);
  return `${typeof base === "string" ? base : "/cdn/assets/"}${file}`;
});
liquid.registerFilter("image_url", (image: { src?: string } | string) => {
  const src = typeof image === "string" ? image : (image?.src ?? "");
  // আসল দোকানের ছবি (//cdn.shopify.com/...) যেমন আছে তেমন
  if (src.startsWith("//")) return `https:${src}`;
  if (/^https?:/.test(src)) return src;
  return `/cdn/shop/${src}`;
});
// দোকানের money_format দিয়ে, Shopify-র money ফিল্টারের মতো
liquid.registerFilter("money", function (this: Filter, cents: number) {
  const format = this.context.getSync(["shop", "money_format"]);
  return (
    formatShopMoney(cents, typeof format === "string" ? format : "${{amount}}") ??
    (cents / 100).toFixed(2)
  );
});
liquid.registerFilter(
  "payment_type_svg_tag",
  (type: string) =>
    `<svg role="img" aria-labelledby="pi-${type}" width="38" height="24" viewBox="0 0 38 24"><title id="pi-${type}">${type}</title><rect width="38" height="24" rx="3" fill="#1a1f71"/></svg>`,
);
// Shopify-র json nil-কে null লেখে, liquidjs কিছুই লেখে না (তাতে customerId: , হয়ে JS ভাঙত)।
// < পালটানো হয় যাতে নকল লেখায় </script> থাকলেও পাতা না ভাঙে।
liquid.registerFilter("json", (value: unknown) =>
  JSON.stringify(value ?? null).replace(/</g, "\\u003c"),
);
/** app embed block-এর নাম (blocks/<নাম>.liquid); Shopify এই নামে block-টাকে চেনে */
export const EMBED_HANDLE = "app-tools-embed";
const EMBED = liquid.parse(
  readFileSync(`${THEME}blocks/${EMBED_HANDLE}.liquid`, "utf8").replace(
    /{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}/,
    "",
  ),
);

export type PageKind = "product" | "cart" | "collection" | "index";

export interface Variant {
  id: number;
  title: string;
  price: number;
  available: boolean;
}

export interface Product {
  id: number;
  handle: string;
  title: string;
  price: number;
  compareAt: number | null;
  tags: string[];
  variants: Variant[];
}

export const PRODUCTS: Product[] = [
  {
    id: 1001,
    handle: "cotton-tee",
    title: "Cotton tee",
    price: 2500,
    compareAt: 3000,
    tags: ["new", "summer"],
    variants: [
      { id: 111, title: "Small", price: 2500, available: true },
      { id: 112, title: "Large", price: 2500, available: false },
    ],
  },
  {
    id: 1002,
    handle: "coffee-mug",
    title: "Coffee mug",
    price: 1200,
    compareAt: null,
    tags: [],
    variants: [{ id: 221, title: "Default Title", price: 1200, available: true }],
  },
  {
    id: 1003,
    handle: "canvas-cap",
    title: "Canvas cap",
    price: 1800,
    compareAt: null,
    tags: [],
    variants: [{ id: 331, title: "Default Title", price: 1800, available: true }],
  },
  {
    id: 1004,
    handle: "wool-socks",
    title: "Wool socks",
    price: 900,
    compareAt: null,
    tags: [],
    variants: [{ id: 441, title: "Default Title", price: 900, available: true }],
  },
];
const TEE = PRODUCTS[0]!;

const byVariant = (id: number) =>
  PRODUCTS.flatMap((p) => p.variants.map((v) => ({ product: p, variant: v }))).find(
    (x) => x.variant.id === id,
  );

/** Shopify-র /products/x.js-এর মতো */
function ajaxProduct(p: Product) {
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    url: `/products/${p.handle}`,
    price: p.price,
    compare_at_price: p.compareAt,
    available: p.variants.some((v) => v.available),
    featured_image: `/cdn/shop/${p.handle}.png`,
    images: [`/cdn/shop/${p.handle}.png`],
    tags: p.tags,
    created_at: "2026-11-20T10:00:00+06:00",
    variants: p.variants.map((v) => ({
      ...v,
      name: `${p.title} - ${v.title}`,
      inventory_management: "shopify",
    })),
  };
}

interface Line {
  variant_id: number;
  quantity: number;
  properties?: Record<string, string> | null;
}

/** দোকানের কার্ট (প্রতিটা পরীক্ষায় নতুন) */
class Cart {
  lines: Line[] = [];
  attributes: Record<string, string> = {};
  note = "";

  json() {
    const items = this.lines.map((line, i) => {
      const found = byVariant(line.variant_id)!;
      const total = found.variant.price * line.quantity;
      return {
        key: `${line.variant_id}:${i}`,
        id: line.variant_id,
        variant_id: line.variant_id,
        product_id: found.product.id,
        product_title: found.product.title,
        variant_title: found.variant.title === "Default Title" ? null : found.variant.title,
        title: found.product.title,
        handle: found.product.handle,
        url: `/products/${found.product.handle}?variant=${line.variant_id}`,
        image: `/cdn/shop/${found.product.handle}.png`,
        quantity: line.quantity,
        price: found.variant.price,
        original_line_price: total,
        final_line_price: total,
        line_price: total,
        properties: line.properties ?? null,
        line_level_discount_allocations: [],
      };
    });
    const total = items.reduce((sum, item) => sum + item.final_line_price, 0);
    return {
      token: "cart-token",
      note: this.note,
      attributes: this.attributes,
      items,
      item_count: items.reduce((sum, item) => sum + item.quantity, 0),
      total_price: total,
      items_subtotal_price: total,
      original_total_price: total,
      total_discount: 0,
      currency: "USD",
      requires_shipping: true,
      cart_level_discount_applications: [],
    };
  }

  add(items: Line[]) {
    for (const item of items) {
      if (!byVariant(Number(item.variant_id))) continue;
      const same = this.lines.find((l) => l.variant_id === Number(item.variant_id));
      if (same) same.quantity += Number(item.quantity) || 1;
      else
        this.lines.push({
          variant_id: Number(item.variant_id),
          quantity: Number(item.quantity) || 1,
          properties: item.properties ?? null,
        });
    }
  }

  change(line: number, quantity: number) {
    const index = line - 1;
    if (!this.lines[index]) return;
    if (quantity <= 0) this.lines.splice(index, 1);
    else this.lines[index]!.quantity = quantity;
  }
}

interface VariantStock {
  available: boolean;
  inventory_policy: "deny" | "continue";
  inventory_quantity: number;
}

export interface ProductOptions {
  /** পাতায় বেছে রাখা ভ্যারিয়েন্ট (ডিফল্ট 111, Small) */
  variantId?: number;
  /** ভ্যারিয়েন্টের স্টক বদলানো; ডিফল্ট: 111-এর ৪টা আছে, 112 শেষ */
  variants?: Record<number, Partial<VariantStock>>;
}

export interface StoreOptions {
  /** চালু টুল; সেটিংস না দিলে ডিফল্ট */
  tools: Array<{ id: string; settings?: Record<string, unknown> }>;
  page?: PageKind;
  /** পাতার প্রোডাক্ট: কোন ভ্যারিয়েন্ট বেছে রাখা, কোনটার স্টক কেমন */
  product?: ProductOptions;
  /** অফার (Volume Discounts, Bundles ...) */
  offers?: Record<string, unknown> | null;
  /** শুরুতেই কার্টে যা থাকে */
  cart?: Line[];
  /** localStorage-এ আগে থেকে যা থাকে (যেমন আগে দেখা প্রোডাক্ট) */
  storage?: Record<string, string>;
  /** App Proxy-র কোনো পথের উত্তর বদলানো */
  proxy?: Record<string, unknown>;
  locale?: string;
  country?: string;
  /**
   * ধীর নেটওয়ার্কের মতো: পাতার HTML কয়েক টুকরোয় আসে (মাঝে মাঝে থিমের একটা ধীর স্ক্রিপ্ট), তাই
   * ব্রাউজার HTML পড়া শেষ হওয়ার আগেই কয়েকবার পাতা আঁকে। থামার জায়গা: <body>-এর শুরু, Add to cart
   * ফর্মের মাঝখান, বিবরণের মাঝখান, কার্টের চেকআউট বাটনের পরে।
   */
  slow?: boolean;
  /**
   * সাধারণ Dawn দোকানের মতো ভারী পাতা: থিমের CSS/JS, Shopify-র স্ক্রিপ্ট, বড় ছবি, সার্ভারের সময়
   * (e2e/weight.ts)। শুধু গতির পরীক্ষায় (e2e/speed.ts), যাতে Lighthouse-এর স্কোর ১০০-তে আটকে না থাকে।
   */
  weight?: boolean;
  /**
   * ডেভেলপমেন্ট স্টোরের মতো পাসওয়ার্ড: না দিলে সব পাতা /password-এ পাঠায় (আসল থিমের পরীক্ষার নিজের
   * পরীক্ষায়, e2e/themes.ts)। /password-এ সঠিক পাসওয়ার্ড POST করলে কুকি দেয়।
   */
  password?: string;
  /**
   * আসল দোকানের মতো: টুলের ফাইল পাতা আঁকার পরে আসে (LATE_MS দেরিতে)। নকল দোকান এত দ্রুত যে নইলে
   * অনেক টুল পাতা আঁকার আগেই বসে যায়, আর পরে আসা উইজেট লেখা নিচে ঠেলে কিনা ধরা পড়ে না।
   */
  late?: boolean;
  /** টুলের ফাইল এটা মেটার পরে আসে: পরীক্ষা নিজে ছাড়ে, যেমন টুল আসার আগে বাটন চাপা দেখতে */
  hold?: Promise<unknown>;
}

/** slow পাতায় প্রতিটা থামা কতক্ষণ (এর মধ্যে ব্রাউজার পাতা আঁকে) */
const PAUSE_MS = 200;

/** late দোকানে টুলের ফাইল কতটা দেরিতে আসে; ততক্ষণে পাতা আঁকা হয়ে যায় */
const LATE_MS = 300;

/** দোকানে আসা একটা অনুরোধ; Playwright-এর route বা আসল সার্ভার, দুই জায়গা থেকেই আসে */
export interface StoreRequest {
  method: string;
  /** পুরো ঠিকানা (https://shop.test/cart.js ...) */
  url: string;
  body: string | null;
  /** ব্রাউজারের Cookie হেডার */
  cookie?: string | null;
}

export interface StoreResponse {
  status: number;
  contentType: string;
  body: string | Buffer;
  /** বাকি হেডার (location, set-cookie), ছোট হাতের নামে */
  headers?: Record<string, string>;
}

export interface Store {
  cart: Cart;
  /** দোকানে আমাদের সার্ভারে কোন কোন অনুরোধ গেল ("GET reviews" ...) */
  proxyCalls: string[];
  /** নকল দোকানের সার্ভার: একটা অনুরোধের উত্তর */
  respond(request: StoreRequest): Promise<StoreResponse>;
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

const json = (body: unknown, status = 200): StoreResponse => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const redirect = (location: string, headers: Record<string, string> = {}): StoreResponse => ({
  status: 302,
  contentType: "text/html; charset=utf-8",
  body: "",
  headers: { location, ...headers },
});

/** পাসওয়ার্ড দেওয়ার পরে দোকানের কুকি (আসল দোকানে _shopify_essential বা storefront_digest) */
const UNLOCKED = "storefront_digest=test-unlocked";

/** ডেভেলপমেন্ট স্টোরের পাসওয়ার্ড পাতার মতো */
const passwordPage = (wrong: boolean): StoreResponse => ({
  status: 200,
  contentType: "text/html; charset=utf-8",
  body: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Opening soon</title></head>
<body>
  <main>
    <h1>Opening soon</h1>
    <form method="post" action="/password" class="storefront-password-form">
      <input type="hidden" name="form_type" value="storefront_password">
      <label for="Password">Password</label>
      <input type="password" name="password" id="Password">
      ${wrong ? '<p role="alert">Wrong password</p>' : ""}
      <button type="submit">Enter</button>
    </form>
  </main>
</body>
</html>`,
});

/** App Proxy-র নকল উত্তর: সাধারণ দোকানে যা আসে তার মতো */
export function proxyAnswer(
  path: string,
  method: string,
  options: Pick<StoreOptions, "proxy">,
): unknown {
  const key = path.split("?")[0]!;
  if (options.proxy && key in options.proxy) return options.proxy[key];
  switch (key) {
    case "reviews":
      return {
        summary: { average: 4.5, count: 2, distribution: [1, 1, 0, 0, 0] },
        page: 1,
        hasMore: false,
        reviews: [
          {
            id: "r1",
            rating: 5,
            title: "Lovely tee",
            body: "Soft fabric and it fits well.",
            authorName: "Rahim",
            verified: true,
            reply: null,
            createdAt: "2026-11-01T10:00:00Z",
            images: [],
          },
          {
            id: "r2",
            rating: 4,
            title: null,
            body: "Nice colour.",
            authorName: "Karim",
            verified: false,
            reply: "Thank you!",
            createdAt: "2026-10-20T10:00:00Z",
            images: [],
          },
        ],
      };
    case "recent-sales":
      return {
        sales: [
          {
            title: "Coffee mug",
            url: "/products/coffee-mug",
            image: "/cdn/shop/coffee-mug.png",
            soldAt: new Date(Date.now() - 600_000).toISOString(),
          },
        ],
      };
    case "fx":
      return { base: "USD", rates: { USD: 1, EUR: 0.9, GBP: 0.8, BDT: 120 } };
    case "wishlist":
      return { items: [] };
    case "chat":
      // app/lib/chat.server.ts: নতুন ক্রেতার কোনো কথোপকথন নেই
      return { online: true, messages: [], hasEmail: false };
    case "push":
      return method === "GET"
        ? {
            key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
          }
        : { ok: true };
    case "recordings":
      return { ok: false, stop: "test" };
    case "events":
      return { ok: true };
    default:
      return { ok: true };
  }
}

/** Shopify-র Liquid variant অবজেক্টের যে অংশ embed পড়ে */
export interface LiquidVariant {
  id: number;
  title: string;
  url: string;
  price: number;
  compare_at_price: number | null;
  sku: string;
  barcode: string;
  inventory_management: string | null;
  available: boolean;
  inventory_policy: "deny" | "continue";
  inventory_quantity: number;
}

/**
 * আমাদের অ্যাপের metafield (রিভিউর রেটিং, AI FAQ), নকল। আসল থিমের পরীক্ষাতেও এগুলোই, যাতে দোকানে অ্যাপ
 * না থাকলেও উইজেটগুলো দেখা যায়।
 */
const METAFIELDS = {
  reviews: { rating_count: { value: 2 }, rating: { value: { rating: "4.5" } } },
  $app: {
    ai_faq: {
      value: {
        items: [
          { question: "Does it shrink?", answer: "Very little, if you wash it cold." },
          { question: "Is it see-through?", answer: "No, the fabric is 180 gsm." },
        ],
      },
    },
  },
};

/** Shopify-র Liquid product অবজেক্টের যে অংশ embed পড়ে */
export interface LiquidProduct {
  id: number;
  handle: string;
  title: string;
  url: string;
  vendor: string;
  tags: string[];
  created_at: string;
  description: string;
  images: Array<{ src: string }>;
  selected_or_first_available_variant: LiquidVariant;
  variants: LiquidVariant[];
  metafields: typeof METAFIELDS;
}

/** Shopify-র Liquid product অবজেক্ট (embed যা পড়ে), টি-শার্টের */
function liquidProduct(options: ProductOptions): LiquidProduct {
  const variants = TEE.variants.map((v): LiquidVariant => ({
    id: v.id,
    title: v.title,
    url: `/products/${TEE.handle}?variant=${v.id}`,
    price: v.price,
    compare_at_price: TEE.compareAt,
    sku: `TEE-${v.id}`,
    barcode: "",
    inventory_management: "shopify",
    available: v.available,
    inventory_policy: "deny",
    inventory_quantity: v.available ? 4 : 0,
    ...options.variants?.[v.id],
  }));
  return {
    id: TEE.id,
    handle: TEE.handle,
    title: TEE.title,
    url: `/products/${TEE.handle}`,
    vendor: "Test store",
    tags: TEE.tags,
    created_at: "2026-11-20T10:00:00+06:00",
    description: "<p>A soft cotton tee for every day.</p>",
    images: [{ src: `${TEE.handle}.png` }],
    selected_or_first_available_variant:
      variants.find((v) => v.id === (options.variantId ?? 111)) ?? variants[0]!,
    variants,
    metafields: METAFIELDS,
  };
}

/** আসল দোকানের /products/x.js-এর যে অংশ লাগে */
export interface AjaxProductData {
  id: number;
  handle: string;
  title: string;
  vendor?: string;
  tags?: string[];
  created_at?: string;
  description?: string;
  images?: string[];
  variants: Array<{
    id: number;
    title: string;
    price: number;
    compare_at_price?: number | null;
    available: boolean;
    sku?: string | null;
    barcode?: string | null;
    inventory_management?: string | null;
  }>;
}

/**
 * আসল দোকানের প্রোডাক্ট (/products/x.js) → embed-এর Liquid product। x.js-এ স্টকের সংখ্যা থাকে না, তাই
 * Shopify যে ভ্যারিয়েন্টের স্টক গোনে তার নকল ৪টা (স্টক কমের বার্তা দেখাতে)।
 */
export function liquidFromAjax(p: AjaxProductData): LiquidProduct {
  const variants = p.variants.map((v): LiquidVariant => ({
    id: v.id,
    title: v.title,
    url: `/products/${p.handle}?variant=${v.id}`,
    price: v.price,
    compare_at_price: v.compare_at_price ?? null,
    sku: v.sku ?? "",
    barcode: v.barcode ?? "",
    inventory_management: v.inventory_management ?? null,
    available: v.available,
    inventory_policy: "deny",
    inventory_quantity: v.available ? 4 : 0,
  }));
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    url: `/products/${p.handle}`,
    vendor: p.vendor ?? "",
    tags: p.tags ?? [],
    created_at: p.created_at ?? "2026-01-01T00:00:00Z",
    description: p.description ?? "",
    images: (p.images ?? []).map((src) => ({ src })),
    selected_or_first_available_variant: variants.find((v) => v.available) ?? variants[0]!,
    variants,
    metafields: METAFIELDS,
  };
}

/**
 * পাতার যে তথ্য app embed-এর Liquid পড়ে (Shopify-র global অবজেক্ট থেকে)। নকল দোকানে আমাদের নকল
 * প্রোডাক্ট আর কার্ট থেকে; আসল থিমের পরীক্ষায় (e2e/themes.ts) আসল দোকানের পাতা আর Ajax API থেকে।
 */
export interface PageFacts {
  kind: PageKind;
  /** request.origin */
  origin: string;
  /** asset_url-এর শুরু: নকল দোকানে /cdn/assets/ */
  assetBase: string;
  locale: string;
  country: string;
  /** দোকান যে দেশগুলোতে বিক্রি করে (Geolocation Redirect) */
  countries: string[];
  /** ক্রেতা যে মুদ্রায় দেখছে (cart.currency) */
  currency: string;
  shopCurrency: string;
  moneyFormat: string;
  shopName: string;
  /** routes.root_url, যেমন "/" বা "/fr" */
  root: string;
  cart: { total: number; count: number };
  product: LiquidProduct | null;
  collection: { title: string; url: string; default_sort_by: string } | null;
}

/** চালু টুলের কনফিগ, দোকানের app_config.tools metafield-এর মতো */
function storeConfig(tools: StoreOptions["tools"]) {
  const config = buildStoreConfig(
    registry,
    tools.map((t) => ({ toolId: t.id, enabled: true, settings: t.settings ?? {} })),
    "professional",
  );
  // ভুল সেটিংস দিলে buildStoreConfig চুপচাপ ডিফল্ট বসায়; পরীক্ষায় সেটা ধরা দরকার
  for (const tool of tools) {
    const built = config.tools.find((t) => t.id === tool.id);
    if (!built) throw new Error(`${tool.id} is not a storefront tool`);
    for (const [key, value] of Object.entries(tool.settings ?? {})) {
      if (JSON.stringify(built.settings[key]) !== JSON.stringify(value)) {
        throw new Error(`${tool.id}: setting ${key}=${JSON.stringify(value)} was rejected`);
      }
    }
  }
  return config;
}

/** app embed-এর HTML (blocks/app-tools-embed.liquid), দোকান যেভাবে <head>-এ বসায় */
export function embedFor(
  options: Pick<StoreOptions, "tools" | "offers">,
  facts: PageFacts,
): string {
  const config = storeConfig(options.tools);
  // Shopify-র global অবজেক্ট; app embed এগুলো পড়ে
  const globals = {
    app: {
      metafields: {
        app_config: {
          tools: { value: { ...config, placement: null, appId: "123" } },
          offers: { value: options.offers ?? null },
        },
      },
    },
    asset_base: facts.assetBase,
    request: {
      page_type: facts.kind,
      origin: facts.origin,
      locale: { iso_code: facts.locale },
    },
    routes: { root_url: facts.root },
    cart: {
      currency: { iso_code: facts.currency },
      total_price: facts.cart.total,
      item_count: facts.cart.count,
    },
    shop: {
      name: facts.shopName,
      currency: facts.shopCurrency,
      money_format: facts.moneyFormat,
      enabled_currencies: [{ iso_code: facts.shopCurrency }],
      enabled_payment_types: ["visa", "master"],
      brand: { logo: null, short_description: "" },
    },
    customer: null,
    localization: {
      country: { iso_code: facts.country },
      available_countries: facts.countries.map((iso_code) => ({ iso_code })),
    },
    product: facts.product,
    collection: facts.collection,
  };
  const html = liquid.renderSync(EMBED, {}, { globals }) as string;
  // Shopify প্রতিটা app block এই মন্তব্যের মাঝে রাখে; আসল থিমের পরীক্ষা এটা দেখে দোকানে বসানো embed সরায়
  return html.trim()
    ? `<!-- BEGIN app block: shopify://apps/app-tools/blocks/${EMBED_HANDLE}/0b6f2a52-6b8e-4c43-9e6f-2f4f3b1c5d10 -->${html}<!-- END app block -->`
    : html;
}

function page(kind: PageKind, options: StoreOptions, origin: string, extraKb = 0): string {
  const product = liquidProduct(options.product ?? {});
  const selected = product.selected_or_first_available_variant;
  const items = options.cart ?? [];
  const embed = embedFor(options, {
    kind,
    origin,
    assetBase: "/cdn/assets/",
    locale: options.locale ?? "en",
    country: options.country ?? "BD",
    countries: ["BD", "US", "DE"],
    currency: "USD",
    shopCurrency: "USD",
    moneyFormat: "${{amount}}",
    shopName: "Test store",
    root: "/",
    cart: {
      total: items.reduce(
        (sum, l) => sum + (byVariant(l.variant_id)?.variant.price ?? 0) * l.quantity,
        0,
      ),
      count: items.reduce((sum, l) => sum + l.quantity, 0),
    },
    product: kind === "product" ? product : null,
    collection:
      kind === "collection"
        ? { title: "All products", url: "/collections/all", default_sort_by: "manual" }
        : null,
  });
  const pause = (where: string) =>
    options.slow ? `<script src="/__pause/${where}"></script>` : "";
  const card = (p: Product) => `
        <li class="grid__item">
          <div class="card-wrapper product-card-wrapper">
            <div class="card__media"><img src="/cdn/shop/${p.handle}.png" alt="${p.title}" width="300" height="300"></div>
            <h3 class="card__heading"><a href="/products/${p.handle}">${p.title}</a></h3>
            <div class="price"><span class="price-item">$${(p.price / 100).toFixed(2)}</span></div>
          </div>
        </li>`;
  const main = {
    product: `
      <section class="shopify-section" id="shopify-section-main-product">
        <div class="product">
          <div class="product__media">
            <img src="/cdn/shop/cotton-tee.png" alt="White cotton tee, front" width="560" height="560">
          </div>
          <div class="product__info-container">
            <h1 class="product__title">Cotton tee</h1>
            <div class="price">
              <span class="price-item price-item--sale">$25.00</span>
              <s class="price-item price-item--regular">$30.00</s>
            </div>
            <product-form class="product-form">
              <form method="post" action="/cart/add" id="product-form-main" class="form" data-type="add-to-cart-form">
                <label for="variant-select">Size</label>
                <select id="variant-select" name="id">
                  <option value="111"${selected.id === 111 ? " selected" : ""}>Small</option>
                  <option value="112"${selected.id === 112 ? " selected" : ""}>Large</option>
                </select>
                <label for="quantity">Quantity</label>
                <input id="quantity" type="number" name="quantity" value="1" min="1">
                ${pause("form")}
                <button type="submit" name="add" class="product-form__submit button">${selected.available ? "Add to cart" : "Sold out"}</button>
                <div class="shopify-payment-button"><button type="button" class="shopify-payment-button__button">Buy it now</button></div>
              </form>
            </product-form>
            <div class="product__description rte">
              <p>A soft cotton tee for every day.</p>
              <h2>Materials</h2>
              <p>100% organic cotton.</p>
              ${pause("description")}
              <h2>Care</h2>
              <p>Wash cold, dry flat.</p>
            </div>
            <div class="product__accordion">
              <details><summary>Shipping and returns</summary><p>Free shipping over $50. Free returns within 30 days.</p></details>
              <details><summary>Size and fit</summary><p>True to size. The model is 180 cm and wears a Large.</p></details>
            </div>
          </div>
        </div>
      </section>`,
    cart: `
      <section class="shopify-section">
        <h1>Your cart</h1>
        <form action="/cart" method="post" id="cart">
          <ul class="cart-items"><li>Cotton tee × 1</li></ul>
          <p class="totals">Subtotal: $25.00</p>
          <button type="submit" name="checkout" class="cart__checkout-button button">Check out</button>
          ${pause("cart")}
          <div class="additional-checkout-buttons" data-shopify="dynamic-checkout-cart"><button type="button">Express checkout</button></div>
        </form>
      </section>`,
    collection: `
      <section class="shopify-section">
        <h1>All products</h1>
        <h2>Products</h2>
        <ul class="product-grid grid">${PRODUCTS.map(card).join("")}</ul>
      </section>`,
    index: `
      <section class="shopify-section">${options.weight ? HERO : ""}
        <h1>Welcome to Test store</h1>
        <p>Everyday clothes and home goods.</p>
        <h2>Featured products</h2>
        <ul class="product-grid grid">${PRODUCTS.map(card).join("")}</ul>
      </section>`,
  }[kind];
  const chrome = options.weight ? weightChrome(extraKb) : { menu: "", footer: "" };

  return `<!doctype html>
<html lang="${options.locale ?? "en"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Test store</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; color: #121212; background: #fff; line-height: 1.5; }
    a { color: #121212; }
    .skip { position: absolute; left: -9999px; }
    .skip:focus { left: 8px; top: 8px; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid #ddd; gap: 16px; }
    header nav { display: flex; gap: 16px; }
    main { max-width: 1100px; margin: 0 auto; padding: 24px; }
    .product { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
    .product img { width: 100%; height: auto; background: #eee; }
    @media (max-width: 749px) { .product { grid-template-columns: 1fr; } }
    .price-item--regular { color: #555; margin-left: 8px; }
    .product__accordion summary { padding: 12px 0; border-top: 1px solid #ddd; cursor: pointer; }
    label { display: block; margin-top: 12px; }
    select, input { font: inherit; padding: 8px; min-height: 44px; box-sizing: border-box; }
    .button, .shopify-payment-button__button { display: block; width: 100%; margin-top: 12px; min-height: 48px; font: inherit; background: #121212; color: #fff; border: 0; cursor: pointer; }
    .shopify-payment-button__button { background: #5a31f4; }
    .grid { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
    .card__media img { width: 100%; height: auto; background: #eee; }
    .card__heading { font-size: 16px; margin: 8px 0 0; }
    footer { border-top: 1px solid #ddd; padding: 24px; margin-top: 48px; }
  </style>${options.weight ? weightHead(kind) : ""}
  <!-- content_for_header: Shopify নিজে যা বসায় -->
  <script>
    window.Shopify = {
      shop: "test-store.myshopify.com",
      routes: { root: "/" },
      currency: { active: "USD", rate: "1.0" },
      theme: { name: "Test theme", id: 1, schema_name: "Test theme", schema_version: "1.0.0", theme_store_id: null, role: "main" },
      country: "${options.country ?? "BD"}",
      locale: "${options.locale ?? "en"}",
      loadFeatures: function (features, callback) { callback(); },
      analytics: { visitor: function () { return true; } },
      customerPrivacy: {
        shouldShowBanner: function () { return true; },
        currentVisitorConsent: function () { return {}; },
        analyticsProcessingAllowed: function () { return true; },
        setTrackingConsent: function (consent, callback) { callback(); }
      }
    };
  </script>
  <!-- app embed (target: head), Shopify </head>-এর ঠিক আগে বসায় -->
  ${embed}
</head>
<body>
  ${pause("body")}
  <a class="skip" href="#MainContent">Skip to content</a>
  <header>
    <a href="/" class="header__heading-link">Test store</a>
    <nav aria-label="Main menu"><a href="/collections/all">Shop</a><a href="/pages/about">About</a>${chrome.menu}</nav>
    <form action="/search" method="get" role="search" class="search">
      <label for="Search-In-Header">Search</label>
      <input id="Search-In-Header" type="search" name="q" placeholder="Search">
    </form>
    <a href="/cart" id="cart-icon-bubble" class="header__icon--cart">Cart <span class="cart-count-bubble">${options.cart?.length ?? 0}</span></a>
  </header>
  <main id="MainContent">${main}</main>
  <footer role="contentinfo">
    ${chrome.footer}<p>© 2026 Test store</p>
    <a href="https://example.com/partner">Partner site</a>
  </footer>
  <script>
    // থিমের নিজের Ajax কার্ট (Dawn-এর product-form-এর মতো): পেজ না বদলে কার্টে যোগ
    document.addEventListener("submit", function (event) {
      var form = event.target;
      if (event.defaultPrevented || !form.matches('form[action="/cart/add"]')) return;
      event.preventDefault();
      fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(new FormData(form))
      })
        .then(function () { return fetch("/cart.js"); })
        .then(function (res) { return res.json(); })
        .then(function (cart) { document.querySelector(".cart-count-bubble").textContent = cart.item_count; });
    });
  </script>
</body>
</html>`;
}

/** কোন পাতা কোন ঠিকানায় */
export const PATHS: Record<PageKind, string> = {
  product: "/products/cotton-tee",
  cart: "/cart",
  collection: "/collections/all",
  index: "/",
};

/**
 * নকল দোকান বানানো: প্রতিটা অনুরোধের উত্তর দেয় (পাতা, উইজেটের ফাইল, কার্ট, App Proxy)।
 * Playwright-এর পরীক্ষা (openStore) আর Lighthouse-এর আসল সার্ভার (serve.ts) দুটোই এটা ব্যবহার করে।
 * origin: দোকানের ঠিকানা, পাতার Liquid-এ request.origin হিসেবে যায়।
 */
export function createStore(options: StoreOptions, origin = ORIGIN): Store {
  const cart = new Cart();
  cart.add(options.cart ?? []);
  const proxyCalls: string[] = [];

  async function respond({
    method,
    url: href,
    body: raw,
    cookie,
  }: StoreRequest): Promise<StoreResponse> {
    const url = new URL(href);
    const path = url.pathname;
    let body: Record<string, unknown> = {};
    if (raw) {
      try {
        body = (JSON.parse(raw) as Record<string, unknown> | null) ?? {};
      } catch {
        // form data
        body = Object.fromEntries(new URLSearchParams(raw));
      }
    }

    if (options.password !== undefined) {
      if (path === "/password") {
        if (method !== "POST") return passwordPage(false);
        return body.password === options.password
          ? redirect("/", { "set-cookie": `${UNLOCKED}; Path=/; Secure; HttpOnly; SameSite=Lax` })
          : passwordPage(true);
      }
      const unlocked = (cookie ?? "").split(/;\s*/).includes(UNLOCKED);
      // CDN-এর ফাইল খোলা, বাকি সব (পাতা, Ajax API) পাসওয়ার্ডের পরে
      if (!unlocked && !path.startsWith("/cdn/") && !path.startsWith("/__pause/")) {
        return redirect("/password");
      }
    }

    if (path.startsWith("/cdn/assets/")) {
      const file = path.slice("/cdn/assets/".length);
      if (options.late && file.startsWith("tool-")) {
        await new Promise((resolve) => setTimeout(resolve, LATE_MS));
      }
      if (options.hold && file.startsWith("tool-")) await options.hold;
      try {
        const content = readFileSync(ASSETS + file);
        return {
          status: 200,
          contentType: file.endsWith(".css") ? "text/css" : "application/javascript",
          body: content,
        };
      } catch {
        return { status: 404, contentType: "text/plain", body: "" };
      }
    }
    if (path.startsWith("/__pause/")) {
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      return { status: 200, contentType: "application/javascript", body: "" };
    }
    const heavy = options.weight ? WEIGHT_ASSETS[path] : undefined;
    if (heavy) return { status: 200, contentType: heavy.contentType, body: heavy.body() };
    if (path.startsWith("/cdn/shop/")) {
      return { status: 200, contentType: "image/png", body: PNG };
    }
    if (path === "/cart.js") return json(cart.json());
    if (path === "/cart/add.js" || path === "/cart/add") {
      const items = Array.isArray(body.items)
        ? (body.items as Array<Record<string, unknown>>).map((i) => ({
            variant_id: Number(i.id),
            quantity: Number(i.quantity) || 1,
            properties: (i.properties as Record<string, string>) ?? null,
          }))
        : [{ variant_id: Number(body.id), quantity: Number(body.quantity) || 1 }];
      cart.add(items);
      const added = cart
        .json()
        .items.filter((i) => items.some((x) => x.variant_id === i.variant_id));
      return json(Array.isArray(body.items) ? { items: added } : (added[0] ?? {}));
    }
    if (path === "/cart/change.js") {
      cart.change(Number(body.line) || 1, Number(body.quantity));
      return json(cart.json());
    }
    if (path === "/cart/update.js") {
      if (body.attributes) Object.assign(cart.attributes, body.attributes);
      if (typeof body.note === "string") cart.note = body.note;
      return json(cart.json());
    }
    if (path === "/cart/clear.js") {
      cart.lines = [];
      return json(cart.json());
    }
    if (path === "/products.json") {
      // Shopify-র /products.json: দাম টাকায় লেখা ("25.00"), x.js-এর মতো সেন্টে নয়
      return json({
        products: PRODUCTS.map((p) => ({
          id: p.id,
          title: p.title,
          handle: p.handle,
          vendor: "Test store",
          tags: p.tags,
          images: [{ src: `${origin}/cdn/shop/${p.handle}.png` }],
          variants: p.variants.map((v) => ({
            id: v.id,
            title: v.title,
            price: (v.price / 100).toFixed(2),
            available: v.available,
          })),
        })),
      });
    }
    if (path === "/meta.json") {
      return json({
        name: "Test store",
        currency: "USD",
        money_format: "${{amount}}",
        myshopify_domain: "test-store.myshopify.com",
      });
    }
    const productJs = path.match(/^\/products\/([\w-]+)\.js$/);
    if (productJs) {
      const product = PRODUCTS.find((p) => p.handle === productJs[1]);
      return product ? json(ajaxProduct(product)) : json({}, 404);
    }
    if (path === "/recommendations/products.json") {
      return json({ products: PRODUCTS.slice(1).map(ajaxProduct) });
    }
    if (path === "/search/suggest.json") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const products = PRODUCTS.filter((p) => p.title.toLowerCase().includes(q)).map((p) => ({
        ...ajaxProduct(p),
        image: `/cdn/shop/${p.handle}.png`,
        price: (p.price / 100).toFixed(2),
      }));
      return json({
        resources: {
          results: {
            products,
            collections: [],
            pages: [],
            articles: [],
            queries: q ? [{ text: `${q} tee`, styled_text: `${q} tee` }] : [],
          },
        },
      });
    }
    if (path === "/browsing_context_suggestions.json") {
      return json({
        detected_values: { country: { handle: "DE", name: "Germany" } },
        suggestions: [],
      });
    }
    if (path === "/contact" || path === "/discount/" || path.startsWith("/discount/")) {
      return { status: 200, contentType: "text/html", body: "<p>ok</p>" };
    }
    if (path.startsWith("/apps/app-tools/")) {
      const sub = path.slice("/apps/app-tools/".length) + url.search;
      proxyCalls.push(`${method} ${sub}`);
      if (sub.startsWith("sw.js")) {
        return { status: 200, contentType: "application/javascript", body: "" };
      }
      return json(proxyAnswer(sub, method, options));
    }
    if (
      method === "GET" &&
      (path === "/" ||
        path.startsWith("/products/") ||
        path.startsWith("/collections/") ||
        path === "/cart" ||
        path.startsWith("/pages/"))
    ) {
      const kindFor: PageKind = path.startsWith("/products/")
        ? "product"
        : path.startsWith("/collections/")
          ? "collection"
          : path === "/cart"
            ? "cart"
            : "index";
      if (options.weight) await new Promise((resolve) => setTimeout(resolve, SERVER_MS));
      return {
        status: 200,
        contentType: "text/html; charset=utf-8",
        // ?extra=KB: ভারী পাতায় থিমের ডেটা এতটা বেশি (চাপা অবস্থায়), পাতার আকার বদলে মাপতে (e2e/speed.ts)
        body: page(kindFor, options, origin, Number(url.searchParams.get("extra")) || 0),
      };
    }
    return { status: 404, contentType: "text/plain", body: "not found" };
  }

  return { cart, proxyCalls, respond };
}

/** Headless Chromium-এ নোটিফিকেশনের অনুমতি সবসময় "denied"; নতুন ক্রেতার ব্রাউজারে থাকে "default" */
export async function likeNewVisitor(pageRef: Page) {
  await pageRef.addInitScript(() => {
    try {
      Object.defineProperty(Notification, "permission", { get: () => "default" });
    } catch {
      // Notification নেই
    }
  });
}

/** দোকান খোলা: Playwright-এর পাতায় নকল দোকান বসিয়ে পাতাটা লোড করে */
export async function openStore(pageRef: Page, options: StoreOptions): Promise<Store> {
  const store = createStore(options);

  await likeNewVisitor(pageRef);
  if (options.storage) {
    await pageRef.addInitScript((items: Record<string, string>) => {
      for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
    }, options.storage);
  }

  await pageRef.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    const answer = await store.respond({
      method: request.method(),
      url: request.url(),
      body: request.postData(),
      cookie: await request.headerValue("cookie"),
    });
    return route.fulfill(answer);
  });

  await pageRef.goto(ORIGIN + PATHS[options.page ?? "product"]);
  return store;
}
