/**
 * Meta (Facebook) Pixel-এর হিসাবের অংশ: কোন ইভেন্টে কী তথ্য যাবে, অনুরোধের ঠিকানা কেমন হবে।
 * এখানে নেটওয়ার্ক বা কুকির কোনো কাজ নেই (সেটা index.ts করে), তাই পুরোটা টেস্ট করা যায়।
 *
 * যা কখনো পাঠানো হয় না: নাম, ইমেইল, ফোন, ঠিকানা, আর চেকআউট বা অর্ডার পেজের গোপন লিংক।
 */

export const META_ENDPOINT = "https://www.facebook.com/tr/";
/** _fbp আর _fbc কুকির মেয়াদ (৯০ দিন), Meta-র নিজের পিক্সেলের মতো */
export const COOKIE_MAX_AGE = 90 * 24 * 60 * 60;
const MAX_PIXELS = 3;
const MAX_CONTENT_IDS = 50;
const MAX_URL = 1000;

export type MetaEventName =
  "PageView" | "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase";
export type MetaData = Record<string, string | number | string[]>;

export interface MetaEvent {
  name: MetaEventName;
  /** একই ইভেন্ট দুবার গেলে Meta যাতে একবারই গোনে */
  id: string;
  time: number;
  data: MetaData;
}

export interface BrowserIds {
  fbp: string;
  fbc: string;
}

/** সেটিংসে কমা দিয়ে লেখা পিক্সেল id (সর্বোচ্চ ৩টা, একই id একবার) */
export function parsePixelIds(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const ids: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim();
    if (/^\d{8,20}$/.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, MAX_PIXELS);
}

interface Consent {
  marketingAllowed?: boolean;
  saleOfDataAllowed?: boolean;
}

/**
 * Meta-তে তথ্য পাঠানো যাবে কিনা। দুটো শর্তই লাগে: ক্রেতা মার্কেটিং কুকিতে রাজি,
 * আর তথ্য বিক্রি/শেয়ারে আপত্তি জানাননি। সম্মতি অজানা থাকলে উত্তর "না"।
 */
export function maySendToMeta(consent: Consent | null | undefined): boolean {
  return consent?.marketingAllowed === true && consent.saleOfDataAllowed === true;
}

/** Shopify-র id থেকে শুধু সংখ্যার অংশ ("gid://shopify/Product/12" → "12") */
export function plainId(id: unknown): string {
  if (typeof id !== "string" && typeof id !== "number") return "";
  const text = String(id).trim();
  return /(\d+)$/.exec(text)?.[1] ?? "";
}

interface Money {
  amount?: number | null;
  currencyCode?: string | null;
}

interface VariantLike {
  id?: string | null;
  price?: Money | null;
  product?: { id?: string | null; title?: string | null } | null;
}

interface CartLineLike {
  cost?: { totalAmount?: Money | null } | null;
  merchandise?: VariantLike | null;
  quantity?: number | null;
}

interface CheckoutLike {
  currencyCode?: string | null;
  totalPrice?: Money | null;
  subtotalPrice?: Money | null;
  lineItems?: Array<{ quantity?: number | null; variant?: VariantLike | null } | null> | null;
  order?: { id?: string | null } | null;
  token?: string | null;
}

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** দাম আর মুদ্রা দুটোই ঠিক থাকলে তবেই যোগ হয় (Meta দাম দিলে মুদ্রাও চায়) */
function withValue(data: MetaData, amount: unknown, currency: unknown): MetaData {
  if (
    typeof amount === "number" &&
    Number.isFinite(amount) &&
    amount >= 0 &&
    typeof currency === "string" &&
    /^[A-Za-z]{3}$/.test(currency)
  ) {
    data.value = Math.round(amount * 100) / 100;
    data.currency = currency.toUpperCase();
  }
  return data;
}

const title = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 100) : "");

/** প্রোডাক্ট দেখা: প্রোডাক্টের id যায় (কোন ভ্যারিয়েন্ট নেবে তা তখনো ঠিক হয়নি) */
export function viewContentData(variant: VariantLike | null | undefined): MetaData | null {
  const productId = plainId(variant?.product?.id);
  if (!productId) return null;
  const data: MetaData = { content_ids: [productId], content_type: "product_group" };
  const name = title(variant?.product?.title);
  if (name) data.content_name = name;
  return withValue(data, variant?.price?.amount, variant?.price?.currencyCode);
}

/** কার্টে যোগ: যে ভ্যারিয়েন্ট যোগ হলো তার id */
export function addToCartData(line: CartLineLike | null | undefined): MetaData | null {
  const variantId = plainId(line?.merchandise?.id);
  if (!variantId) return null;
  const data: MetaData = { content_ids: [variantId], content_type: "product" };
  const name = title(line?.merchandise?.product?.title);
  if (name) data.content_name = name;
  const quantity = count(line?.quantity);
  if (quantity) data.num_items = quantity;
  const total = line?.cost?.totalAmount;
  return total?.amount == null
    ? withValue(data, line?.merchandise?.price?.amount, line?.merchandise?.price?.currencyCode)
    : withValue(data, total.amount, total.currencyCode);
}

/** চেকআউট শুরু আর কেনা: সব ভ্যারিয়েন্টের id, মোট সংখ্যা আর মোট দাম */
export function checkoutData(checkout: CheckoutLike | null | undefined): MetaData {
  const ids: string[] = [];
  let items = 0;
  for (const line of checkout?.lineItems ?? []) {
    const id = plainId(line?.variant?.id);
    if (id && !ids.includes(id)) ids.push(id);
    items += count(line?.quantity);
  }
  const data: MetaData = {};
  if (ids.length > 0) {
    data.content_ids = ids.slice(0, MAX_CONTENT_IDS);
    data.content_type = "product";
  }
  if (items) data.num_items = items;
  const total =
    checkout?.totalPrice?.amount == null ? checkout?.subtotalPrice : checkout.totalPrice;
  return withValue(data, total?.amount, total?.currencyCode ?? checkout?.currencyCode);
}

/** কেনার ইভেন্টের id: অর্ডার নম্বর, যাতে একই অর্ডার দুবার গোনা না হয় */
export function purchaseId(checkout: CheckoutLike | null | undefined, fallback: string): string {
  const orderId = plainId(checkout?.order?.id);
  return orderId ? `order-${orderId}` : fallback;
}

/**
 * পেজের ঠিকানা। চেকআউট আর অর্ডার পেজের ঠিকানায় গোপন টোকেন থাকে (লিংক পেলে অর্ডার দেখা যায়),
 * তাই ওসব পেজে শুধু ডোমেইন পাঠানো হয়। অন্য পেজে # এর পরের অংশ বাদ যায়।
 */
export function pageUrl(href: unknown): string {
  if (typeof href !== "string") return "";
  const match = /^(https?:\/\/[^/?#]+)([^?#]*)/i.exec(href);
  if (!match) return "";
  const [, origin = "", path = ""] = match;
  if (/\/(checkouts?|orders)(\/|$)/i.test(path)) return `${origin}/checkout`;
  return (href.split("#")[0] ?? "").slice(0, MAX_URL);
}

const FBP = /^fb\.\d\.\d{10,16}\.\d{1,20}$/;
const FBC = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_-]{1,500}$/;
const FBCLID = /[?&]fbclid=([A-Za-z0-9_-]{1,500})(?:[&#]|$)/;

/** ব্রাউজারের _fbp কুকি: ঠিক থাকলে সেটাই, নইলে নতুন (Meta-র নিজের ফরম্যাটে) */
export function fbpValue(existing: unknown, now: number, random: number): string {
  if (typeof existing === "string" && FBP.test(existing)) return existing;
  return `fb.1.${Math.floor(now)}.${Math.floor(1e9 + random * 9e9)}`;
}

/**
 * _fbc কুকি: ঠিকানায় Facebook বিজ্ঞাপনের fbclid থাকলে তা থেকে, নইলে আগের কুকি (থাকলে)।
 * একই fbclid-এর কুকি আগে থেকে থাকলে তার সময় বদলানো হয় না।
 */
export function fbcValue(existing: unknown, href: unknown, now: number): string {
  const current = typeof existing === "string" && FBC.test(existing) ? existing : "";
  const clickId = typeof href === "string" ? FBCLID.exec(href)?.[1] : undefined;
  if (!clickId) return current;
  if (current.endsWith(`.${clickId}`)) return current;
  return `fb.1.${Math.floor(now)}.${clickId}`;
}

export const cookieString = (name: string, value: string) =>
  `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;

/**
 * Meta-র /tr ঠিকানায় একটা ইভেন্টের GET অনুরোধ।
 * প্যারামিটারগুলো Meta-র নিজের পিক্সেল যা পাঠায় তার সাথে মেলে: id, ev, dl, rl, ts, cd[...], fbp, fbc, eid।
 */
export function metaUrl(
  pixelId: string,
  event: MetaEvent,
  page: { href: unknown; referrer: unknown },
  ids: BrowserIds,
): string {
  const query: string[] = [];
  const add = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === "") return;
    query.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  add("id", pixelId);
  add("ev", event.name);
  add("dl", pageUrl(page.href));
  add("rl", pageUrl(page.referrer));
  add("if", "false");
  add("ts", Math.floor(event.time));
  for (const [key, value] of Object.entries(event.data)) {
    add(`cd[${key}]`, Array.isArray(value) ? JSON.stringify(value) : value);
  }
  add("fbp", ids.fbp);
  add("fbc", ids.fbc);
  add("eid", event.id);
  return `${META_ENDPOINT}?${query.join("&")}`;
}
