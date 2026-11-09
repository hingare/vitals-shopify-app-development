/** প্রোডাক্ট পেজের তথ্য আর দাম দেখানোর ছোট সাহায্যকারী (কয়েকটা টুল একসাথে ব্যবহার করে) */
export interface PageProduct {
  productId: number;
  title: string;
  variantId: number;
  price: string;
  priceCents: number;
  available: boolean;
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
  "countdown-timer",
  "stock-scarcity",
  "volume-discounts",
  "bundles",
  "trust-seals",
  "payment-logos",
];

/**
 * উইজেট প্রোডাক্টের "Add to cart" ফর্মের ঠিক পরে বসায়।
 * থিমের app block ([data-app-slot=...]) থাকলে সেখানেই বসে।
 */
export function placeAfterProductForm(slot: string): HTMLElement {
  const host = document.createElement("div");
  host.dataset.appWidget = slot;
  const block = document.querySelector<HTMLElement>(`[data-app-slot="${slot}"]`);
  if (block) {
    block.appendChild(host);
    return host;
  }
  let box = document.getElementById("app-after-form");
  if (!box) {
    box = document.createElement("div");
    box.id = "app-after-form";
    const form = productForm();
    const anchor = form?.closest(".product-form, product-form") ?? form;
    if (anchor) anchor.after(box);
    else (document.querySelector("main") ?? document.body).appendChild(box);
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

function productForm(): HTMLFormElement | null {
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
 * থিমের app block ([data-app-slot=...]) থাকলে সেখানেই বসে।
 */
export function placeNearCheckout(slot: string): HTMLElement {
  const host = document.createElement("div");
  host.dataset.appWidget = slot;
  const block = document.querySelector<HTMLElement>(`[data-app-slot="${slot}"]`);
  const checkout = document.querySelector<HTMLElement>('main [name="checkout"]');
  if (block) block.appendChild(host);
  else if (checkout?.parentElement) checkout.parentElement.after(host);
  else (document.querySelector("main") ?? document.body).appendChild(host);
  return host;
}
