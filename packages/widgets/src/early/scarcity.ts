/** কম স্টকের বার্তা ("আর মাত্র ৩টা"): early.ts পাতা আঁকার আগেই বসায়, টুলের ফাইল ভেরিয়েন্ট বদলালে বদলায় */
import { fill } from "../dom";
import { h } from "./h";

export interface ScarcitySettings {
  threshold: number;
  stockMessage: string;
  showBar: boolean;
  colors: { background: string; text: string; accent: string };
}

/** দেখানোর মতো কম স্টক হলে সংখ্যাটা, নইলে null */
export function lowStock(
  inventory: Record<string, number> | undefined,
  variantId: string,
  threshold: number,
): number | null {
  const qty = inventory?.[variantId];
  return typeof qty === "number" && qty > 0 && qty <= threshold ? qty : null;
}

export function buildScarcity(s: ScarcitySettings, qty: number): HTMLElement {
  return h(
    "div",
    `margin:12px 0;padding:8px 0;background:${s.colors.background};color:${s.colors.text};font-weight:600`,
    {},
    h("p", "margin:0", {}, fill(s.stockMessage, { n: qty })),
    ...(s.showBar
      ? [
          h(
            "div",
            "height:6px;margin-top:6px;border-radius:3px;background:rgba(0,0,0,.08);overflow:hidden",
            { "aria-hidden": "true" },
            h(
              "div",
              `width:${Math.max(8, (qty / s.threshold) * 100)}%;height:100%;background:${s.colors.accent}`,
            ),
          ),
        ]
      : []),
  );
}
