/** প্রোডাক্ট পেজের তথ্য আর দাম দেখানোর ছোট সাহায্যকারী (কয়েকটা টুল একসাথে ব্যবহার করে) */
export interface PageProduct {
  productId: number;
  title: string;
  variantId: number;
  price: string;
  priceCents: number;
  available: boolean;
  handle?: string;
  tags?: string[];
  createdAt?: string;
  compareAtCents?: number;
  /** ভেরিয়েন্ট id → স্টকে কয়টা আছে (শুধু যেগুলোর স্টক Shopify গোনে) */
  inventory?: Record<string, number>;
}

export function readPageProduct(): PageProduct | null {
  const el = document.getElementById("app-product-json");
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as PageProduct;
  } catch {
    return null;
  }
}

export function money(cents: number, currency: string | undefined, locale: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency || "USD" }).format(
      amount,
    );
  } catch {
    return amount.toFixed(2);
  }
}

/** ছাড়ের পরে এক পিসের দাম (সেন্টে) */
export function discounted(cents: number, value: { percent?: number; amountEach?: number }) {
  if (value.percent) return Math.max(0, Math.round(cents * (1 - value.percent / 100)));
  if (value.amountEach) return Math.max(0, cents - Math.round(value.amountEach * 100));
  return cents;
}

/** Add to cart-এর নিচে উইজেটগুলোর ক্রম (ফাইল যে ক্রমেই লোড হোক, সাজানো থাকে একই রকম) */
const AFTER_FORM_ORDER = [
  "shipping-info",
  "size-chart",
  "countdown-timer",
  "stock-scarcity",
  "volume-discounts",
  "bundles",
  "trust-seals",
  "payment-logos",
  "social-buttons",
  // মূল প্রোডাক্ট সেকশনের পরে
  "related-products",
  "recently-viewed",
];

/**
 * থিমের প্রোফাইল: জনপ্রিয় থিমগুলোতে Add to cart ফর্ম যে ঘরের ভেতরে থাকে।
 * উইজেট এর ঠিক পরে বসে, যাতে থিমের নিজের বাটনের সারির মাঝে ঢুকে না পড়ে।
 */
const PRODUCT_FORM_WRAPPERS = [
  "product-form", // Dawn ও Online Store 2.0 থিম
  ".product-form",
  ".product-single__form", // পুরনো (Debut-ধরনের) থিম
  ".product__form",
  ".ProductForm", // Prestige-ধরনের থিম
].join(",");

function find(selector: string): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(selector);
  } catch {
    return null; // ভুল selector থাকলে নিজের খোঁজায় ফিরে যাই
  }
}

/** একই জায়গায় কয়েকটা উইজেট থাকলে তাদের একটা বাক্স, ক্রম ঠিক রেখে */
function ordered(boxId: string, place: (box: HTMLElement) => void, slot: string): HTMLElement {
  const host = document.createElement("div");
  host.dataset.appWidget = slot;
  let box = document.getElementById(boxId);
  if (!box) {
    box = document.createElement("div");
    box.id = boxId;
    place(box);
  }
  const rank = (name?: string) => {
    const i = AFTER_FORM_ORDER.indexOf(name ?? "");
    return i === -1 ? AFTER_FORM_ORDER.length : i;
  };
  const next = [...box.children].find(
    (child) => rank((child as HTMLElement).dataset.appWidget) > rank(slot),
  );
  box.insertBefore(host, next ?? null);
  return host;
}

function put(box: HTMLElement, anchor: HTMLElement | null, where: "after" | "before" = "after") {
  if (anchor) anchor[where](box);
  else (document.querySelector("main") ?? document.body).appendChild(box);
}

/** থিম এডিটরে মার্চেন্ট আমাদের app block বসালে উইজেট সেখানেই যায় */
export function slotHost(slot: string): HTMLElement | null {
  const block = document.querySelector<HTMLElement>(`[data-app-slot="${slot}"]`);
  if (!block) return null;
  const host = document.createElement("div");
  host.dataset.appWidget = slot;
  block.appendChild(host);
  return host;
}

/**
 * উইজেট প্রোডাক্টের "Add to cart" ফর্মের ঠিক পরে বসায়।
 * ক্রম: থিমের app block → মার্চেন্টের দেওয়া selector → থিম প্রোফাইল → ফর্ম।
 */
export function placeAfterProductForm(slot: string): HTMLElement {
  const block = slotHost(slot);
  if (block) return block;
  return ordered(
    "app-after-form",
    (box) => {
      const custom = window.__APP_CONFIG__?.placement;
      const chosen = custom?.productAnchor ? find(custom.productAnchor) : null;
      if (chosen) return put(box, chosen, custom?.productWhere);
      const form = productForm();
      put(box, form?.closest<HTMLElement>(PRODUCT_FORM_WRAPPERS) ?? form);
    },
    slot,
  );
}

export function productForm(): HTMLFormElement | null {
  return document.querySelector<HTMLFormElement>(
    'main form[action*="/cart/add"]:not([id*="installment"])',
  );
}

/** ক্রেতা এখন যে ভেরিয়েন্ট বেছে রেখেছে */
export function currentVariantId(fallback: number): string {
  const input = productForm()?.querySelector<HTMLInputElement | HTMLSelectElement>('[name="id"]');
  return input?.value || new URLSearchParams(location.search).get("variant") || String(fallback);
}

/** ভেরিয়েন্ট বদলালে ডাকে (থিম ফর্মের input বদলায়, তাই change ইভেন্ট শুনলেই হয়) */
export function onVariantChange(callback: () => void) {
  document.addEventListener("change", (event) => {
    if ((event.target as Element | null)?.closest?.("form, variant-selects, variant-radios")) {
      setTimeout(callback, 60);
    }
  });
}

/**
 * কার্ট পেজে চেকআউট বাটনের কাছে বসায়।
 * ক্রম: থিমের app block → মার্চেন্টের দেওয়া selector → চেকআউট বাটনের ঘর।
 */
export function placeNearCheckout(slot: string): HTMLElement {
  const block = slotHost(slot);
  if (block) return block;
  return ordered(
    "app-near-checkout",
    (box) => {
      const custom = window.__APP_CONFIG__?.placement;
      const chosen = custom?.cartAnchor ? find(custom.cartAnchor) : null;
      if (chosen) return put(box, chosen, custom?.cartWhere);
      put(box, find('main [name="checkout"]')?.parentElement ?? null);
    },
    slot,
  );
}

/** স্টোরের ভাষা অনুযায়ী পথের শুরু, যেমন "/" বা "/fr/" */
export const root = () => window.Shopify?.routes?.root ?? "/";

/** মূল প্রোডাক্ট সেকশনের ঠিক পরে (সুপারিশ, আগে দেখা প্রোডাক্ট) */
export function placeAfterProductSection(slot: string): HTMLElement {
  const block = slotHost(slot);
  if (block) return block;
  return ordered(
    "app-after-section",
    (box) =>
      put(
        box,
        productForm()?.closest<HTMLElement>(".shopify-section") ??
          document.querySelector<HTMLElement>("main .shopify-section"),
      ),
    slot,
  );
}

/** /products/x.js থেকে পাওয়া প্রোডাক্ট (Shopify-র Ajax API) */
export interface AjaxProduct {
  id: number;
  title: string;
  handle: string;
  url?: string;
  price: number;
  compare_at_price?: number | null;
  available: boolean;
  featured_image?: string | null;
  tags?: string[];
  created_at?: string;
}

const productCache = new Map<string, Promise<AjaxProduct | null>>();

export function fetchProduct(handle: string): Promise<AjaxProduct | null> {
  let pending = productCache.get(handle);
  if (!pending) {
    pending = fetch(`${root()}products/${encodeURIComponent(handle)}.js`)
      .then((res) => (res.ok ? (res.json() as Promise<AjaxProduct>) : null))
      .catch(() => null);
    productCache.set(handle, pending);
  }
  return pending;
}

/** "//cdn.shopify.com/...jpg" → ছোট সাইজের https URL */
export function imageUrl(src: string | null | undefined, width = 360): string {
  if (!src) return "";
  const url = src.startsWith("//") ? `https:${src}` : src;
  return `${url}${url.includes("?") ? "&" : "?"}width=${width}`;
}
