import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import type { StoreConfig } from "./types";
import { widgetT } from "./i18n";
import { attribute, track } from "./analytics";
import { cartPost } from "./cart-api";
import { type AjaxProduct, discounted, fetchProduct, imageUrl, money } from "./product";
import { type Upsell, upsellsFor } from "./offers";
import { ONE_LINE, TEXT, UPSELL_ROW } from "./early/reserve";

export { type Upsell, upsellsFor };

const TOOL_ID = "upsells";

/** অফারের প্রোডাক্টগুলো (যেগুলো এখনই আছে বা ট্রিগার নয়) */
export async function loadUpsellProducts(offer: Upsell, exclude: string[]) {
  const products = await Promise.all(
    offer.products.filter((p) => !exclude.includes(p.id)).map((p) => fetchProduct(p.handle)),
  );
  return products.filter((p): p is AjaxProduct => p !== null && p.available);
}

function Row({
  product,
  offer,
  config,
  accent,
  onAdded,
}: {
  product: AjaxProduct;
  offer: Upsell;
  config: StoreConfig;
  accent: string;
  onAdded?: () => void;
}) {
  const t = (key: Parameters<typeof widgetT>[1]) => widgetT(config.locale, key);
  const variants = (product.variants ?? []).filter((v) => v.available);
  const [variantId, setVariantId] = useState(variants[0]?.id);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const variant = variants.find((v) => v.id === variantId);
  const price = variant?.price ?? product.price;
  const offerPrice = offer.value ? discounted(price, offer.value) : price;
  const format = (cents: number) => money(cents, config.currency, config.locale);
  if (!variantId) return null;

  async function add() {
    setState("busy");
    const ok = await cartPost("cart/add.js", { items: [{ id: variantId, quantity: 1 }] });
    setState(ok ? "done" : "error");
    if (ok) {
      track(TOOL_ID, "add_to_cart");
      attribute(TOOL_ID);
      onAdded?.();
    }
  }

  return (
    <li
      style={`display:flex;gap:12px;align-items:center;margin:0;padding:8px 0;height:${UPSELL_ROW}px;box-sizing:border-box`}
    >
      {product.featured_image && (
        <img
          src={imageUrl(product.featured_image, 160)}
          alt=""
          width={64}
          height={64}
          loading="lazy"
          style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "6px" }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <a
          href={product.url ?? `/products/${product.handle}`}
          onClick={() => track(TOOL_ID, "click")}
          style={`${ONE_LINE};display:block;color:inherit;font-weight:600;text-decoration:none`}
        >
          {product.title}
        </a>
        <div style={ONE_LINE}>
          <span style={{ color: accent, fontWeight: 600 }}>{format(offerPrice)}</span>
          {offerPrice < price && <s style={{ marginLeft: "6px", opacity: 0.6 }}>{format(price)}</s>}
        </div>
        {variants.length > 1 && (
          <select
            aria-label={`${product.title} ${t("option")}`}
            value={variantId}
            onChange={(e) => setVariantId(Number((e.target as HTMLSelectElement).value))}
            style={{
              display: "block",
              marginTop: "4px",
              height: "32px",
              maxWidth: "100%",
              padding: "0 4px",
              boxSizing: "border-box",
              font: "inherit",
            }}
          >
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title}
              </option>
            ))}
          </select>
        )}
      </div>
      <button
        type="button"
        onClick={() => void add()}
        disabled={state === "busy" || state === "done"}
        style={{
          flex: "none",
          height: "36px",
          padding: "0 14px",
          boxSizing: "border-box",
          font: "inherit",
          border: 0,
          borderRadius: "6px",
          background: accent,
          color: "#fff",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        {state === "busy" ? t("adding") : state === "done" ? t("added") : t("add")}
      </button>
      {state === "error" && (
        <span role="alert" style={{ position: "absolute", left: "-9999px" }}>
          {t("cartFailed")}
        </span>
      )}
    </li>
  );
}

/** একটা upsell অফারের প্রোডাক্ট তালিকা ("এটাও নিন") */
export function UpsellList({
  offer,
  config,
  exclude,
  colors,
  onAdded,
  onReady,
}: {
  offer: Upsell;
  config: StoreConfig;
  exclude: string[];
  colors: { background: string; text: string; accent: string };
  onAdded?: () => void;
  /** প্রোডাক্ট এসে তালিকা বসলে (বা দেখানোর কিছু না থাকলে), রাখা জায়গা ছাড়তে */
  onReady?: () => void;
}) {
  const [products, setProducts] = useState<AjaxProduct[] | null>(null);
  useEffect(() => {
    void loadUpsellProducts(offer, exclude).then((list) => {
      setProducts(list);
      if (list.length > 0) track(TOOL_ID, "view");
    });
    // exclude বদলালে (কার্টে যোগ হলে) আবার বাছাই
  }, [offer.id, exclude.join(",")]);
  useLayoutEffect(() => {
    if (products) onReady?.();
  }, [products]);
  if (!products || products.length === 0) return null;
  const heading = offer.title || widgetT(config.locale, "upsellHeading");
  return (
    <section
      aria-label={heading}
      style={`${TEXT};margin:16px 0;color:${colors.text};background:${colors.background}`}
    >
      <p style={`${TEXT};${ONE_LINE};margin:0 0 4px;font-weight:700`}>{heading}</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {products.map((p) => (
          <Row
            key={p.id}
            product={p}
            offer={offer}
            config={config}
            accent={colors.accent}
            onAdded={onAdded}
          />
        ))}
      </ul>
    </section>
  );
}
