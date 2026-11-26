/**
 * Bundles আর Upsells-এর প্রোডাক্ট পরে আসে (/products/x.js), তাই পাতা আঁকার আগে early.ts শুধু ঠিক ততটা
 * জায়গা রাখে যতটা বাক্স নেবে। এজন্য বাক্সের মাপ বাঁধা: লেখা ১৪px/২০px, প্রতিটা সারির উচ্চতা নির্দিষ্ট,
 * লম্বা নাম এক লাইনে কেটে যায় (…)। এখানকার মাপ আর bundles.tsx / upsell.tsx-এর স্টাইল একসাথে বদলাতে হয়;
 * e2e/tools.e2e.ts মিলিয়ে দেখে (পাতা সরলে ব্যর্থ)।
 */

/** বাক্সের লেখা: থিমের ফন্ট, কিন্তু মাপ আমাদের (থিম p-এর মাপ বদলালেও তাই <p>-এ আবার দেওয়া) */
export const TEXT = "font-size:14px;line-height:20px";
/** এক লাইনের লেখা, বেশি লম্বা হলে … */
export const ONE_LINE = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";

/** Bundles: ১৬ মার্জিন ×২, ১ বর্ডার ×২, ১৬ প্যাডিং ×২, শিরোনাম ২০ + ১২, মোট দাম ১২ + ২০ + ১২, বাটন ৪৪ */
export const BUNDLE_ROW = 68;
export const bundleHeight = (items: number) => 186 + BUNDLE_ROW * items;

/** Upsells: ১৬ মার্জিন ×২, শিরোনাম ২০ + ৪ */
export const UPSELL_ROW = 92;
export const upsellHeight = (products: number) => 56 + UPSELL_ROW * products;

/** জায়গা রাখা; flow-root, যাতে ভেতরের বাক্সের মার্জিনও এই মাপের ভেতরে থাকে */
export function reserve(host: HTMLElement, px: number): HTMLElement {
  host.style.display = "flow-root";
  if (px > 0) host.style.minHeight = `${px}px`;
  return host;
}

/** বাক্স বসে গেলে (বা দেখানোর কিছু না থাকলে) রাখা জায়গা ছেড়ে দেওয়া */
export function release(host: HTMLElement) {
  host.style.removeProperty("min-height");
}
