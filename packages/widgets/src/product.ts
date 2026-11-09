/** প্রোডাক্ট পেজের তথ্য আর দাম দেখানোর ছোট সাহায্যকারী (কয়েকটা টুল একসাথে ব্যবহার করে) */
export interface PageProduct {
  productId: number;
  title: string;
  variantId: number;
  price: string;
  priceCents: number;
  available: boolean;
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
  const form = document.querySelector<HTMLFormElement>(
    'main form[action*="/cart/add"]:not([id*="installment"])',
  );
  const anchor = form?.closest(".product-form, product-form") ?? form;
  if (anchor) anchor.after(host);
  else (document.querySelector("main") ?? document.body).appendChild(host);
  return host;
}
