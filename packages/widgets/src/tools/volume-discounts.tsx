import { render } from "preact";
import type { OfferValue, ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { discounted, money, placeAfterProductForm, readPageProduct } from "../product";

const TOOL_ID = "volume-discounts";

interface Settings {
  showTable: boolean;
  colors: { background: string; text: string; accent: string };
}

function label(value: OfferValue, format: (cents: number) => string) {
  if (value.percent) return `${value.percent}%`;
  return format(Math.round((value.amountEach ?? 0) * 100));
}

/** প্রোডাক্ট পেজে "বেশি কিনলে বেশি ছাড়" টেবিল */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType !== "product" || !s.showTable) return;
  const product = readPageProduct();
  if (!product) return;
  const id = String(product.productId);
  const offer = config.offers?.volume.find(
    (o) => o.productIds.length === 0 || o.productIds.includes(id),
  );
  if (!offer || offer.tiers.length === 0) return;

  const t = (key: Parameters<typeof widgetT>[1]) => widgetT(config.locale, key);
  const format = (cents: number) => money(cents, config.currency, config.locale);
  track(TOOL_ID, "view");

  render(
    <div
      style={{
        margin: "16px 0",
        padding: "12px 16px",
        border: `1px solid ${s.colors.accent}`,
        borderRadius: "8px",
        background: s.colors.background,
        color: s.colors.text,
      }}
    >
      <p style={{ margin: "0 0 8px", fontWeight: 600 }}>{t("buyMoreSave")}</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {offer.tiers.map((tier) => (
            <tr key={tier.minQty} style={{ borderTop: "1px solid rgba(0,0,0,.08)" }}>
              <td style={{ padding: "6px 0" }}>
                {t("buyQty").replace("{n}", String(tier.minQty))}
              </td>
              <td style={{ padding: "6px 0", color: s.colors.accent, fontWeight: 600 }}>
                {t("saveValue").replace("{v}", label(tier.value, format))}
              </td>
              <td style={{ padding: "6px 0", textAlign: "right" }}>
                {format(discounted(product.priceCents, tier.value))} {t("each")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: "8px 0 0", fontSize: "13px", opacity: 0.75 }}>{t("appliedAtCheckout")}</p>
    </div>,
    placeAfterProductForm("volume-discounts"),
  );
}
