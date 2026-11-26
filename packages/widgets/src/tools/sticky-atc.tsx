import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { attribute, track } from "../analytics";
import { watchBottom } from "../dom";
import {
  currentVariantId,
  fetchProduct,
  money,
  onVariantChange,
  readPageProduct,
  type PageProduct,
} from "../product";

const TOOL_ID = "sticky-atc";

interface Settings {
  position: "bottom" | "top";
  showOnMobile: boolean;
  colors: { background: string; text: string; accent: string };
}

interface Shown {
  variantId: string;
  price: string;
  available: boolean;
}

function StickyBar({
  settings,
  product,
  locale,
  currency,
}: {
  settings: Settings;
  product: PageProduct;
  locale: string;
  currency: string | undefined;
}) {
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");
  // The variant the shopper has picked in the theme's product form, with its own price and stock
  const [shown, setShown] = useState<Shown>({
    variantId: String(product.variantId),
    price: product.price,
    available: product.available,
  });
  const { colors } = settings;

  useEffect(
    () =>
      onVariantChange(() => {
        const variantId = currentVariantId(product.variantId);
        setState("idle");
        setShown((prev) => ({ ...prev, variantId }));
        if (!product.handle) return;
        void fetchProduct(product.handle).then((ajax) => {
          const variant = ajax?.variants?.find((v) => String(v.id) === variantId);
          if (!variant) return;
          setShown((prev) =>
            prev.variantId === variantId
              ? {
                  variantId,
                  price: money(variant.price, currency, locale),
                  available: variant.available,
                }
              : prev,
          );
        });
      }),
    [],
  );

  async function add() {
    track(TOOL_ID, "click");
    setState("adding");
    const res = await fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: currentVariantId(product.variantId), quantity: 1 }] }),
    });
    if (res.ok) {
      track(TOOL_ID, "add_to_cart");
      void attribute(TOOL_ID);
    }
    setState(res.ok ? "added" : "idle");
  }

  return (
    <div
      role="region"
      aria-label={product.title}
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        [settings.position]: 0,
        zIndex: 2147483000,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "10px 16px",
        background: colors.background,
        color: colors.text,
        boxShadow: "0 0 12px rgba(0,0,0,.12)",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {product.title} · {shown.price}
      </span>
      <button
        type="button"
        onClick={add}
        disabled={state === "adding" || !shown.available}
        style={{
          background: colors.accent,
          color: "#fff",
          border: 0,
          borderRadius: "8px",
          padding: "10px 18px",
          cursor: "pointer",
          minHeight: "44px",
        }}
      >
        {!shown.available
          ? widgetT(locale, "soldOut")
          : state === "added"
            ? widgetT(locale, "added")
            : widgetT(locale, "addToCart")}
      </button>
    </div>
  );
}

export function mount({ config, settings }: ToolContext) {
  if (config.pageType !== "product") return;
  const s = settings as unknown as Settings;
  if (!s.showOnMobile && window.matchMedia("(max-width: 749px)").matches) return;
  const product = readPageProduct();
  if (!product) return;
  const host = document.createElement("div");
  host.id = "app-sticky-atc";
  document.body.appendChild(host);
  track(TOOL_ID, "view");
  render(
    <StickyBar settings={s} product={product} locale={config.locale} currency={config.currency} />,
    host,
  );
  // চ্যাট, মুদ্রা আর অন্য ভাসমান বোতাম এর উপরে বসে (bottomOffset); মাপটা আগেভাগে তৈরি থাকে
  watchBottom(host.firstElementChild);
}
