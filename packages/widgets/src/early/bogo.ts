/** BOGO অফারের লেখা ("২টা কিনলে ১টা ফ্রি"): early.ts পাতা আঁকার আগেই Add to cart-এর নিচে বসায় */
import type { OfferValue, StoreConfig } from "../types";
import { type EarlyString, earlyT } from "../i18n-early";
import { fill } from "../dom";
import { type PageProduct, money } from "../product";
import { offerShown } from "../offers";
import { h } from "./h";

export interface BogoSettings {
  showBadge: boolean;
  colors: { background: string; text: string; accent: string };
}

/** এই প্রোডাক্টে এখন দেখানোর মতো প্রথম BOGO অফার */
export function bogoOffer(config: StoreConfig, product: PageProduct) {
  const id = String(product.productId);
  return (config.offers?.bogo ?? []).find(
    (o) =>
      offerShown(o.rules, config) &&
      (o.buyProductIds.length === 0 ||
        o.buyProductIds.includes(id) ||
        o.getProductIds.includes(id)),
  );
}

/** "২টা কিনলে ১টা ফ্রি" বা "... ৫০% ছাড়ে" লেখা */
export function bogoText(
  offer: { buyQty: number; getQty: number; value: OfferValue },
  t: (key: "bogoFree" | "bogoOff") => string,
  format: (cents: number) => string,
) {
  const vars = { buy: offer.buyQty, get: offer.getQty };
  if ((offer.value.percent ?? 0) >= 100) return fill(t("bogoFree"), vars);
  const value = offer.value.percent
    ? `${offer.value.percent}%`
    : format(Math.round((offer.value.amountEach ?? 0) * 100));
  return fill(t("bogoOff"), { ...vars, value });
}

export function buildBogo(
  s: BogoSettings,
  offer: NonNullable<ReturnType<typeof bogoOffer>>,
  config: StoreConfig,
): HTMLElement {
  const t = (key: EarlyString) => earlyT(config.locale, key);
  return h(
    "p",
    `margin:12px 0;padding:10px 14px;border-radius:8px;background:${s.colors.background};color:${s.colors.text};border:1px dashed ${s.colors.accent};font-weight:600`,
    {},
    bogoText(offer, t, (cents) => money(cents, config.currency, config.locale)),
    h(
      "span",
      "display:block;font-weight:400;font-size:13px;opacity:.75",
      {},
      t("appliedAtCheckout"),
    ),
  );
}
