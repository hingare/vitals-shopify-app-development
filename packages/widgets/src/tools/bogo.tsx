import { render } from "preact";
import type { OfferValue, ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { fill } from "../dom";
import { money, placeAfterProductForm, readPageProduct } from "../product";
import { offerShown, syncAbGroup } from "../offers";

const TOOL_ID = "bogo";

interface Settings {
  showBadge: boolean;
  colors: { background: string; text: string; accent: string };
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

/** প্রোডাক্ট পেজে এই প্রোডাক্টের BOGO অফার জানানো */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  syncAbGroup(config);
  if (config.pageType !== "product" || !s.showBadge) return;
  const product = readPageProduct();
  if (!product) return;
  const id = String(product.productId);
  const offer = (config.offers?.bogo ?? []).find(
    (o) =>
      offerShown(o.rules, config) &&
      (o.buyProductIds.length === 0 ||
        o.buyProductIds.includes(id) ||
        o.getProductIds.includes(id)),
  );
  if (!offer) return;
  const t = (key: Parameters<typeof widgetT>[1]) => widgetT(config.locale, key);
  const format = (cents: number) => money(cents, config.currency, config.locale);
  track(TOOL_ID, "view");
  render(
    <p
      style={{
        margin: "12px 0",
        padding: "10px 14px",
        borderRadius: "8px",
        background: s.colors.background,
        color: s.colors.text,
        border: `1px dashed ${s.colors.accent}`,
        fontWeight: 600,
      }}
    >
      {bogoText(offer, t, format)}
      <span style={{ display: "block", fontWeight: 400, fontSize: "13px", opacity: 0.75 }}>
        {t("appliedAtCheckout")}
      </span>
    </p>,
    placeAfterProductForm(TOOL_ID),
  );
}
