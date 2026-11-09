import { render } from "preact";
import type { StoreConfig, ToolContext } from "../types";
import { widgetT } from "../i18n";
import { onCartChange } from "../cart";
import { getCart } from "../cart-api";
import { placeAfterProductForm, placeNearCheckout, readPageProduct } from "../product";
import { syncAbGroup } from "../offers";
import { type Upsell, UpsellList, upsellsFor } from "../upsell";

const TOOL_ID = "upsells";

interface Settings {
  popupAfterAdd: boolean;
  showOnProduct: boolean;
  showInCart: boolean;
  colors: { background: string; text: string; accent: string };
}

let popupHost: HTMLElement | null = null;

function closePopup() {
  if (popupHost) render(null, popupHost);
  popupHost?.remove();
  popupHost = null;
}

/** কার্টে যোগের পর ছোট পপআপ: "এটাও নিন" */
function Popup({
  offer,
  config,
  exclude,
  s,
}: {
  offer: Upsell;
  config: StoreConfig;
  exclude: string[];
  s: Settings;
}) {
  const close = widgetT(config.locale, "close");
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={offer.title || widgetT(config.locale, "upsellHeading")}
      onKeyDown={(e) => e.key === "Escape" && closePopup()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483000,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={(e) => e.target === e.currentTarget && closePopup()}
    >
      <div
        style={{
          position: "relative",
          width: "min(440px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          padding: "20px",
          borderRadius: "12px",
          background: s.colors.background,
          color: s.colors.text,
        }}
      >
        <button
          type="button"
          aria-label={close}
          onClick={closePopup}
          autoFocus
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            border: 0,
            background: "transparent",
            fontSize: "22px",
            cursor: "pointer",
            color: "inherit",
          }}
        >
          ×
        </button>
        <UpsellList offer={offer} config={config} exclude={exclude} colors={s.colors} />
      </div>
    </div>
  );
}

/** কার্টে নতুন কোন প্রোডাক্ট এলো তা দেখে পপআপ দেখায় (প্রতি অফার এক সেশনে একবার) */
function watchAdds(config: StoreConfig, s: Settings) {
  let known: Set<string> | null = null;
  const seen = new Set<string>();
  const check = async () => {
    const cart = await getCart();
    if (!cart) return;
    // আমাদের যোগ করা গিফট লাইন বাদ (ক্রেতা নিজে যোগ করেননি)
    const ids = cart.items.filter((i) => !i.properties?._app_gift).map((i) => String(i.product_id));
    const before = known;
    known = new Set(ids);
    if (!before) return;
    const added = ids.filter((id) => !before.has(id));
    if (added.length === 0) return;
    const offer = upsellsFor(config, added, "popup").find((o) => {
      try {
        return !seen.has(o.id) && !sessionStorage.getItem(`app_upsell_${o.id}`);
      } catch {
        return !seen.has(o.id);
      }
    });
    if (!offer) return;
    seen.add(offer.id);
    try {
      sessionStorage.setItem(`app_upsell_${offer.id}`, "1");
    } catch {
      // private mode
    }
    closePopup();
    popupHost = document.createElement("div");
    popupHost.dataset.appWidget = TOOL_ID;
    document.body.appendChild(popupHost);
    render(<Popup offer={offer} config={config} exclude={ids} s={s} />, popupHost);
  };
  void check();
  onCartChange(() => void check());
}

export async function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  syncAbGroup(config);
  if (!config.offers?.upsells?.length) return;

  if (s.showOnProduct && config.pageType === "product") {
    const product = readPageProduct();
    const id = product ? String(product.productId) : "";
    const offer = id ? upsellsFor(config, [id], "product")[0] : undefined;
    if (offer) {
      render(
        <UpsellList offer={offer} config={config} exclude={[id]} colors={s.colors} />,
        placeAfterProductForm(TOOL_ID),
      );
    }
  }

  if (s.showInCart && config.pageType === "cart") {
    const cart = await getCart();
    const ids = cart?.items.map((i) => String(i.product_id)) ?? [];
    const offer = upsellsFor(config, ids, "cart")[0];
    if (offer && ids.length > 0) {
      render(
        <UpsellList
          offer={offer}
          config={config}
          exclude={ids}
          colors={s.colors}
          onAdded={() => location.reload()}
        />,
        placeNearCheckout(TOOL_ID),
      );
    }
  }

  // Cart Drawer চালু থাকলে drawer নিজেই upsell দেখায়, তাই আলাদা পপআপ নয়
  const drawer = config.tools.find((t) => t.id === "cart-drawer");
  const drawerShows = drawer && drawer.settings.openOnAdd !== false;
  if (s.popupAfterAdd && config.pageType !== "cart" && !drawerShows) watchAdds(config, s);
}
