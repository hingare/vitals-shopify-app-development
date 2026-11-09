import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { StoreConfig, ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { type CartLine, type FullCart, cartPost, getCart, isQuietAddUrl } from "../cart-api";
import { imageUrl, money, root } from "../product";
import { Notice, type NoticeSettings } from "../notice";
import { UpsellList, upsellsFor } from "../upsell";

const TOOL_ID = "cart-drawer";
const GIFT_PROPERTY = "_app_gift";

interface Settings {
  openOnAdd: boolean;
  replaceThemeCart: boolean;
  title: string;
  checkoutText: string;
  showUpsells: boolean;
  colors: { background: string; text: string; accent: string };
}

/** থিমের নিজের কার্ট drawer/নোটিফিকেশন লুকানো (একসাথে দুটো কার্ট যেন না খোলে) */
const THEME_CART =
  "cart-drawer,cart-notification,#CartDrawer,#cart-notification,.cart-drawer,.drawer--cart,#mini-cart";

let open: (() => void) | null = null;

function Line({
  line,
  config,
  busy,
  onChange,
}: {
  line: CartLine;
  config: StoreConfig;
  busy: boolean;
  onChange: (key: string, qty: number) => void;
}) {
  const t = (key: Parameters<typeof widgetT>[1]) => widgetT(config.locale, key);
  const format = (cents: number) => money(cents, config.currency, config.locale);
  const gift = Boolean(line.properties?.[GIFT_PROPERTY]);
  const button = {
    width: "28px",
    height: "28px",
    border: "1px solid rgba(0,0,0,.2)",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  };
  return (
    <li
      style={{
        display: "flex",
        gap: "12px",
        padding: "12px 0",
        borderBottom: "1px solid rgba(0,0,0,.08)",
      }}
    >
      {line.image && (
        <img
          src={imageUrl(line.image, 160)}
          alt=""
          width={72}
          height={72}
          style={{ width: "72px", height: "72px", objectFit: "cover", borderRadius: "6px" }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <a href={line.url} style={{ color: "inherit", fontWeight: 600, textDecoration: "none" }}>
          {line.product_title}
        </a>
        {line.variant_title && (
          <div style={{ fontSize: "13px", opacity: 0.75 }}>{line.variant_title}</div>
        )}
        {(line.line_level_discount_allocations ?? []).map((d) => (
          <div key={d.discount_application.title} style={{ fontSize: "13px", color: "#047857" }}>
            {d.discount_application.title} (−{format(d.amount)})
          </div>
        ))}
        {!gift && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px" }}>
            <button
              type="button"
              aria-label={t("decrease")}
              disabled={busy}
              style={button}
              onClick={() => onChange(line.key, line.quantity - 1)}
            >
              −
            </button>
            <span aria-label={t("quantity")} style={{ minWidth: "20px", textAlign: "center" }}>
              {line.quantity}
            </span>
            <button
              type="button"
              aria-label={t("increase")}
              disabled={busy}
              style={button}
              onClick={() => onChange(line.key, line.quantity + 1)}
            >
              +
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onChange(line.key, 0)}
              style={{
                ...button,
                width: "auto",
                border: 0,
                textDecoration: "underline",
                fontSize: "13px",
              }}
            >
              {t("remove")}
            </button>
          </div>
        )}
      </div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {line.final_line_price === 0 ? (
          <strong>{t("free")}</strong>
        ) : (
          <strong>{format(line.final_line_price)}</strong>
        )}
        {line.final_line_price < line.original_line_price && (
          <div>
            <s style={{ opacity: 0.6, fontSize: "13px" }}>{format(line.original_line_price)}</s>
          </div>
        )}
      </div>
    </li>
  );
}

function Drawer({ config, s }: { config: StoreConfig; s: Settings }) {
  const t = (key: Parameters<typeof widgetT>[1]) => widgetT(config.locale, key);
  const [isOpen, setOpen] = useState(false);
  const [cart, setCart] = useState<FullCart | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const openRef = useRef(false);
  openRef.current = isOpen;

  const refresh = () => void getCart().then(setCart);

  useEffect(() => {
    open = () => {
      if (openRef.current) return refresh();
      returnFocus.current = document.activeElement;
      setOpen(true);
      refresh();
      track(TOOL_ID, "view");
    };
    // ক্রেতা কার্টে কিছু যোগ করলে খোলে (আমাদের নিজের যোগ, যেমন গিফট, বাদে)
    if (s.openOnAdd && typeof PerformanceObserver !== "undefined") {
      try {
        new PerformanceObserver((list) => {
          const adds = list
            .getEntries()
            .filter((e) => /\/cart\/add(\.js)?$/.test(new URL(e.name).pathname));
          if (adds.some((e) => !isQuietAddUrl(e.name))) setTimeout(() => open?.(), 120);
          else if (adds.length > 0) refresh();
          else if (list.getEntries().some((e) => /\/cart\/(change|update|clear)/.test(e.name)))
            refresh();
        }).observe({ type: "resource" });
      } catch {
        // পুরনো ব্রাউজার
      }
    }
    return () => {
      open = null;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      // ফোকাস drawer-এর ভেতরেই রাখা
      if (e.key === "Tab" && panel.current) {
        const items = panel.current.querySelectorAll<HTMLElement>(
          "a,button:not([disabled]),select",
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = overflow;
      (returnFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [isOpen]);

  async function change(key: string, quantity: number) {
    setBusy(true);
    await cartPost("cart/change.js", { id: key, quantity: Math.max(0, quantity) });
    setCart(await getCart());
    setBusy(false);
  }

  if (!isOpen) return null;
  const format = (cents: number) => money(cents, cart?.currency ?? config.currency, config.locale);
  const ids = cart?.items.map((i) => String(i.product_id)) ?? [];
  const upsell = s.showUpsells && ids.length > 0 ? upsellsFor(config, ids, "cart")[0] : undefined;
  const notice = config.tools.find((tool) => tool.id === "cart-notice");

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(0,0,0,.45)" }}
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={s.title || t("cartTitle")}
        tabIndex={-1}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: "100%",
          width: "min(420px, 100%)",
          display: "flex",
          flexDirection: "column",
          background: s.colors.background,
          color: s.colors.text,
          boxShadow: "-8px 0 24px rgba(0,0,0,.15)",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(0,0,0,.08)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "18px", flex: 1 }}>
            {s.title || t("cartTitle")} {cart ? `(${cart.item_count})` : ""}
          </h2>
          <button
            type="button"
            aria-label={t("close")}
            onClick={() => setOpen(false)}
            style={{
              border: 0,
              background: "transparent",
              fontSize: "26px",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 20px" }} aria-busy={busy}>
          {notice && <Notice s={notice.settings as unknown as NoticeSettings} />}
          {cart && cart.items.length === 0 && <p style={{ padding: "24px 0" }}>{t("cartEmpty")}</p>}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {cart?.items.map((line) => (
              <Line
                key={line.key}
                line={line}
                config={config}
                busy={busy}
                onChange={(k, q) => void change(k, q)}
              />
            ))}
          </ul>
          {upsell && (
            <UpsellList
              offer={upsell}
              config={config}
              exclude={ids}
              colors={s.colors}
              onAdded={refresh}
            />
          )}
        </div>
        {cart && cart.items.length > 0 && (
          <div style={{ padding: "16px 20px", borderTop: "1px solid rgba(0,0,0,.08)" }}>
            {(cart.cart_level_discount_applications ?? []).map((d) => (
              <div
                key={d.title}
                style={{ display: "flex", justifyContent: "space-between", color: "#047857" }}
              >
                <span>{d.title}</span>
                <span>−{format(d.total_allocated_amount)}</span>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontWeight: 700,
                fontSize: "17px",
              }}
            >
              <span>{t("subtotal")}</span>
              <span>{format(cart.total_price)}</span>
            </div>
            <p style={{ margin: "4px 0 12px", fontSize: "13px", opacity: 0.75 }}>
              {t("taxesAtCheckout")}
            </p>
            <a
              href={`${root()}checkout`}
              onClick={() => track(TOOL_ID, "click")}
              style={{
                display: "block",
                textAlign: "center",
                padding: "14px",
                borderRadius: "8px",
                background: s.colors.accent,
                color: "#fff",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              {s.checkoutText || t("checkout")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/** কার্ট আইকন বা /cart লিংকে চাপলে আমাদের drawer খোলে (কার্ট পেজে নয়) */
function interceptCartLinks() {
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      const path = new URL(link.href, location.href).pathname.replace(/\/$/, "");
      if (path !== `${root()}cart`.replace(/\/$/, "") && path !== "/cart") return;
      e.preventDefault();
      e.stopPropagation();
      open?.();
    },
    true,
  );
}

export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType === "cart") return;
  if (s.replaceThemeCart) {
    const style = document.createElement("style");
    style.textContent = `${THEME_CART}{display:none!important}`;
    document.head.appendChild(style);
    interceptCartLinks();
  }
  const host = document.createElement("div");
  host.dataset.appWidget = TOOL_ID;
  document.body.appendChild(host);
  render(<Drawer config={config} s={s} />, host);
}
