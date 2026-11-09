import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { StoreOffers, ToolContext } from "../types";
import { widgetT, type WidgetString } from "../i18n";
import { attribute, track } from "../analytics";
import { discounted, money, placeAfterProductForm, readPageProduct } from "../product";

const TOOL_ID = "bundles";

interface Settings {
  colors: { background: string; text: string; accent: string };
}

interface ShopVariant {
  id: number;
  title: string;
  price: number;
  available: boolean;
}

interface ShopProduct {
  title: string;
  handle: string;
  featured_image: string | null;
  variants: ShopVariant[];
}

type Bundle = StoreOffers["bundles"][number];

function BundleBox({
  bundle,
  settings,
  locale,
  currency,
}: {
  bundle: Bundle;
  settings: Settings;
  locale: string;
  currency: string | undefined;
}) {
  const t = (key: WidgetString) => widgetT(locale, key);
  const format = (cents: number) => money(cents, currency, locale);
  const [products, setProducts] = useState<Array<ShopProduct | null> | null>(null);
  const [choice, setChoice] = useState<number[]>([]);
  const [state, setState] = useState<"idle" | "adding" | "added" | "error">("idle");
  const { colors } = settings;

  useEffect(() => {
    const root =
      (window as { Shopify?: { routes?: { root?: string } } }).Shopify?.routes?.root ?? "/";
    Promise.all(
      bundle.items.map((item) =>
        fetch(`${root}products/${encodeURIComponent(item.handle)}.js`)
          .then((r) => (r.ok ? (r.json() as Promise<ShopProduct>) : null))
          .catch(() => null),
      ),
    ).then((list) => {
      setProducts(list);
      setChoice(list.map((p) => p?.variants.find((v) => v.available)?.id ?? 0));
    });
  }, [bundle.id]);

  if (!products) return null;
  // কোনো প্রোডাক্ট পাওয়া না গেলে বা স্টকে না থাকলে বান্ডেল দেখাই না
  if (products.some((p, i) => !p || !choice[i])) return null;

  const lines = products.map((p, i) => {
    const variant = p!.variants.find((v) => v.id === choice[i])!;
    return { product: p!, variant, qty: bundle.items[i]!.qty };
  });
  const total = lines.reduce((sum, l) => sum + l.variant.price * l.qty, 0);
  const after = lines.reduce(
    (sum, l) => sum + discounted(l.variant.price, bundle.value) * l.qty,
    0,
  );

  async function addAll() {
    track(TOOL_ID, "click");
    setState("adding");
    try {
      const res = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((l) => ({ id: l.variant.id, quantity: l.qty })),
        }),
      });
      if (!res.ok) throw new Error("cart");
      track(TOOL_ID, "add_to_cart");
      attribute(TOOL_ID);
      setState("added");
      document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
    } catch {
      setState("error");
    }
  }

  return (
    <section
      aria-label={bundle.title || t("buyTogether")}
      style={{
        margin: "16px 0",
        padding: "16px",
        border: `1px solid ${colors.accent}`,
        borderRadius: "8px",
        background: colors.background,
        color: colors.text,
      }}
    >
      <p style={{ margin: "0 0 12px", fontWeight: 600 }}>{bundle.title || t("buyTogether")}</p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {lines.map((l, i) => (
          <li
            key={l.product.handle}
            style={{ display: "flex", gap: "12px", alignItems: "center", padding: "6px 0" }}
          >
            {l.product.featured_image && (
              <img
                src={`${l.product.featured_image}${l.product.featured_image.includes("?") ? "&" : "?"}width=120`}
                alt=""
                width={56}
                height={56}
                loading="lazy"
                style={{ objectFit: "cover", borderRadius: "6px" }}
              />
            )}
            <div style={{ flex: 1 }}>
              <div>
                {l.qty > 1 ? `${l.qty} × ` : ""}
                {l.product.title}
              </div>
              {l.product.variants.length > 1 && (
                <select
                  aria-label={`${l.product.title}: ${t("option")}`}
                  value={choice[i]}
                  onChange={(e) => {
                    const next = [...choice];
                    next[i] = Number((e.currentTarget as HTMLSelectElement).value);
                    setChoice(next);
                  }}
                  style={{ marginTop: "4px", padding: "4px", font: "inherit" }}
                >
                  {l.product.variants.map((v) => (
                    <option key={v.id} value={v.id} disabled={!v.available}>
                      {v.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div style={{ textAlign: "right" }}>{format(l.variant.price * l.qty)}</div>
          </li>
        ))}
      </ul>
      <p style={{ margin: "12px 0" }}>
        {t("bundleTotal")}{" "}
        {after < total && <s style={{ opacity: 0.6, marginRight: "6px" }}>{format(total)}</s>}
        <strong style={{ color: colors.accent }}>{format(after)}</strong>
      </p>
      <button
        type="button"
        onClick={() => void addAll()}
        disabled={state === "adding"}
        style={{
          width: "100%",
          minHeight: "44px",
          border: 0,
          borderRadius: "8px",
          background: colors.accent,
          color: "#fff",
          font: "inherit",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {state === "added" ? t("added") : t("addBundle")}
      </button>
      {state === "error" && (
        <p role="alert" style={{ margin: "8px 0 0", color: "#B42318" }}>
          {t("cartFailed")}
        </p>
      )}
    </section>
  );
}

/** প্রোডাক্ট পেজে "একসাথে কিনুন" বক্স: এই প্রোডাক্ট যে বান্ডেলে আছে তার প্রথমটা */
export function mount({ config, settings }: ToolContext) {
  if (config.pageType !== "product") return;
  const product = readPageProduct();
  if (!product) return;
  const id = String(product.productId);
  const bundle = config.offers?.bundles.find((b) => b.items.some((i) => i.productId === id));
  if (!bundle) return;
  track(TOOL_ID, "view");
  render(
    <BundleBox
      bundle={bundle}
      settings={settings as unknown as Settings}
      locale={config.locale}
      currency={config.currency}
    />,
    placeAfterProductForm("bundles"),
  );
}
