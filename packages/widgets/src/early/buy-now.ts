/**
 * Accelerated Checkout-এর "Buy now" বাটন। থিমের Add to cart-এর ঠিক পরে বসে, তাই পাতা আঁকার পরে বসলে
 * নিচের সবকিছু (আমাদের অন্য উইজেট, বিবরণ) নিচে সরে যেত। early.ts বাটনটা পাতা আঁকার আগেই বসায়, টুলের
 * ফাইল পরে এসে চাপার কাজ জুড়ে দেয়।
 */
import { h } from "./h";

export const BUY_NOW = "accelerated-checkout";

export interface BuyNowSettings {
  buyNowButton: boolean;
  buttonText: string;
  colors: { accent: string };
}

/** থিমের Add to cart বাটন */
export const submitOf = (form: HTMLFormElement) =>
  form.querySelector<HTMLElement>('[type="submit"], [name="add"]');

export function buildBuyNow(s: BuyNowSettings): HTMLButtonElement {
  return h(
    "button",
    `display:block;width:100%;margin-top:10px;padding:14px 16px;border:0;border-radius:6px;cursor:pointer;font:inherit;font-weight:700;background:${s.colors.accent};color:#fff`,
    { type: "button", "data-app-widget": BUY_NOW },
    s.buttonText,
  );
}

/** Add to cart-এর পরে; সেটা না পেলে ফর্মের শেষে */
export function placeBuyNow(form: HTMLFormElement, button: HTMLElement) {
  (submitOf(form) ?? form.lastElementChild ?? form).after(button);
}
