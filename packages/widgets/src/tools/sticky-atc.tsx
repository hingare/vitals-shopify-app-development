import { render } from "preact";
import { useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { widgetT } from "../i18n";

interface Settings {
  position: "bottom" | "top";
  showOnMobile: boolean;
  colors: { background: string; text: string; accent: string };
}

interface ProductInfo {
  title: string;
  variantId: string;
  price: string;
  available: boolean;
}

function readProduct(): ProductInfo | null {
  const el = document.getElementById("app-product-json");
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as ProductInfo;
  } catch {
    return null;
  }
}

function StickyBar({
  settings,
  product,
  locale,
}: {
  settings: Settings;
  product: ProductInfo;
  locale: string;
}) {
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");
  const { colors } = settings;

  async function add() {
    setState("adding");
    const res = await fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: product.variantId, quantity: 1 }] }),
    });
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
        {product.title} · {product.price}
      </span>
      <button
        type="button"
        onClick={add}
        disabled={state === "adding" || !product.available}
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
        {!product.available
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
  const product = readProduct();
  if (!product) return;
  const host = document.createElement("div");
  host.id = "app-sticky-atc";
  document.body.appendChild(host);
  render(<StickyBar settings={s} product={product} locale={config.locale} />, host);
}
