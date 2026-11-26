import type { OfferValue, StoreConfig, StoreOffers } from "../types";
import { earlyT } from "../i18n-early";
import { type PageProduct, discounted, money } from "../product";
import { offerShown } from "../offers";
import { h } from "./h";

/** Volume Discounts-এর টেবিল: পাতা আঁকার আগে early.ts বানায় (অফার আর দাম পাতাতেই থাকে) */

export interface VolumeSettings {
  showTable: boolean;
  colors: { background: string; text: string; accent: string };
}

type VolumeOffer = StoreOffers["volume"][number];

/** এই প্রোডাক্টে এখন দেখানোর মতো প্রথম অফার */
export function volumeOffer(config: StoreConfig, product: PageProduct): VolumeOffer | undefined {
  const id = String(product.productId);
  return config.offers?.volume.find(
    (o) =>
      o.tiers.length > 0 &&
      offerShown(o.rules, config) &&
      (o.productIds.length === 0 || o.productIds.includes(id)),
  );
}

export function buildVolume(
  offer: VolumeOffer,
  product: PageProduct,
  s: VolumeSettings,
  config: StoreConfig,
): HTMLElement {
  const t = (key: Parameters<typeof earlyT>[1]) => earlyT(config.locale, key);
  const format = (cents: number) => money(cents, config.currency, config.locale);
  const label = (value: OfferValue) =>
    value.percent ? `${value.percent}%` : format(Math.round((value.amountEach ?? 0) * 100));

  return h(
    "div",
    `margin:16px 0;padding:12px 16px;border:1px solid ${s.colors.accent};border-radius:8px;background:${s.colors.background};color:${s.colors.text}`,
    {},
    h("p", "margin:0 0 8px;font-weight:600", {}, t("buyMoreSave")),
    h(
      "table",
      "width:100%;border-collapse:collapse",
      {},
      h(
        "tbody",
        "",
        {},
        ...offer.tiers.map((tier) =>
          h(
            "tr",
            "border-top:1px solid rgba(0,0,0,.08)",
            {},
            h("td", "padding:6px 0", {}, t("buyQty").replace("{n}", String(tier.minQty))),
            h(
              "td",
              `padding:6px 0;color:${s.colors.accent};font-weight:600`,
              {},
              t("saveValue").replace("{v}", label(tier.value)),
            ),
            h(
              "td",
              "padding:6px 0;text-align:right",
              {},
              `${format(discounted(product.priceCents, tier.value))} ${t("each")}`,
            ),
          ),
        ),
      ),
    ),
    h("p", "margin:8px 0 0;font-size:13px;opacity:.75", {}, t("appliedAtCheckout")),
  );
}
