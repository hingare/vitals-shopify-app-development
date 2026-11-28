/**
 * Back in Stock-এর "স্টকে এলে জানাও" বাটন, বেছে রাখা ভ্যারিয়েন্টের স্টক শেষ হলে। early.ts পাতা আঁকার
 * আগেই বসায়; টুলের ফাইল পরে এসে একই বাটন বসায় (back-in-stock.tsx, একই স্টাইল) আর চাপলে ফর্ম খোলে।
 */
import { outlinedButton } from "./button";
import { h } from "./h";

export interface NotifySettings {
  notifyText: string;
  colors: { background: string; text: string; accent: string };
}

/**
 * এই ভ্যারিয়েন্ট এখন কেনা যায় না কিনা। পেজের `inventory`-তে শুধু সেই ভ্যারিয়েন্টগুলো থাকে যাদের
 * স্টক Shopify গোনে আর স্টক শেষে বিক্রি বন্ধ; সেখানে ০ বা কম মানেই স্টক শেষ।
 */
export function isSoldOut(inventory: Record<string, number> | undefined, variantId: string) {
  const quantity = inventory?.[variantId];
  return typeof quantity === "number" && quantity <= 0;
}

/** বন্ধ অবস্থার বাক্স আর বাটন (ফর্ম খোলার আগে) */
export const notifyBox = (s: NotifySettings) =>
  `margin:12px 0;padding:0;border-radius:10px;background:none;color:${s.colors.text};border:0`;
export const notifyButton = (s: NotifySettings) => `${outlinedButton(s.colors.accent)};width:100%`;

export function buildNotify(s: NotifySettings): HTMLElement {
  return h("div", notifyBox(s), {}, h("button", notifyButton(s), { type: "button" }, s.notifyText));
}
