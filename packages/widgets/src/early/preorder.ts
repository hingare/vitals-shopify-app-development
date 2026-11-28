/**
 * Pre-Orders: স্টক শেষ কিন্তু "স্টক না থাকলেও বিক্রি" চালু ভ্যারিয়েন্টে Add to cart-এর লেখা বদলায়, ফর্মের নিচে
 * বার্তা দেখায় আর দ্রুত চেকআউট বাটন লুকায়। early.ts তিনটাই পাতা আঁকার আগে করে, কারণ পরে বার্তা বসলে বা
 * বাটন লুকালে নিচের লেখা সরে যেত। টুলের ফাইল পরে এসে অর্ডারের লাইনে লেখা যোগ করে আর ভ্যারিয়েন্ট বদলানো দেখে।
 */
import { fill } from "../dom";
import { formatDate } from "../dates";
import { earlyT } from "../i18n-early";
import type { PageProduct } from "../product";
import { h } from "./h";

export interface PreorderSettings {
  buttonText: string;
  preorderMessage: string;
  shipDate: string;
  onlyTag: string;
  colors: { background: string; text: string; accent: string };
}

/** প্রি-অর্ডারের ভ্যারিয়েন্টগুলো; মার্চেন্ট ট্যাগ দিলে শুধু সেই ট্যাগের প্রোডাক্টে */
export function preorderIds(s: PreorderSettings, product: PageProduct): Set<string> {
  const tag = s.onlyTag.toLowerCase();
  if (tag && !(product.tags ?? []).some((t) => t.toLowerCase() === tag)) return new Set();
  return new Set((product.preorder ?? []).map(String));
}

/** ক্রেতাকে দেখানো আর অর্ডারের লাইনে রাখা লেখা */
export function preorderText(s: PreorderSettings, locale: string): string {
  if (!s.shipDate) {
    return s.preorderMessage.includes("{date}")
      ? earlyT(locale, "preorderNoDate")
      : s.preorderMessage;
  }
  const [y = 0, m = 1, d = 1] = s.shipDate.split("-").map(Number);
  return fill(s.preorderMessage, { date: formatDate(y, m, d, locale) ?? s.shipDate });
}

export const buildPreorder = (s: PreorderSettings, text: string) =>
  h(
    "p",
    `margin:12px 0;padding:10px 14px;border-radius:8px;font-weight:600;background:${s.colors.background};color:${s.colors.text};border:1px solid ${s.colors.accent}`,
    {},
    text,
  );

/**
 * দ্রুত চেকআউট বাটন (Shop Pay ইত্যাদি) লুকানোর style: সেই বাটন অর্ডারের লাইনে প্রি-অর্ডারের লেখা রাখে না।
 * একটাই থাকে: early.ts বসালে টুল সেটাই নেয়, যাতে অন্য ভ্যারিয়েন্টে সরালে পুরোটা সরে।
 */
export function hideFastCheckout(): HTMLStyleElement {
  const id = "app-preorder-style";
  return (
    (document.getElementById(id) as HTMLStyleElement | null) ??
    h("style", "", { id }, ".shopify-payment-button{display:none!important}")
  );
}

/** বাটনের ভেতরের যে অংশে লেখা থাকে (Dawn-এর মতো থিমে <span>) */
export function labelOf(button: HTMLElement): HTMLElement {
  const spans = [...button.querySelectorAll<HTMLElement>("span")].filter(
    (el) => el.children.length === 0 && el.textContent?.trim(),
  );
  return spans[0] ?? button;
}

/** বাটনে প্রি-অর্ডারের লেখা; থিমের লেখা data-app-text-এ থাকে, অন্য ভ্যারিয়েন্টে ফেরত দিতে */
export function preorderLabel(button: HTMLElement, text: string) {
  const label = labelOf(button);
  if (label.textContent === text) return;
  label.dataset.appText = label.textContent ?? "";
  label.textContent = text;
}
