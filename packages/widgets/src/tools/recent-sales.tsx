import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { timeAgo } from "../dates";
import { bottomOffset, fill, isMobile } from "../dom";
import { imageUrl } from "../product";

const TOOL_ID = "recent-sales";
const CLOSED_KEY = "app_recent_sales_closed";

interface Sale {
  title: string;
  url: string;
  image: string | null;
  soldAt: string;
}

interface Settings {
  saleMessage: string;
  firstDelaySeconds: number;
  intervalSeconds: number;
  displaySeconds: number;
  position: "bottom-left" | "bottom-right";
  showOnMobile: boolean;
  colors: { background: string; text: string; accent: string };
}

function Toasts({ s, sales, locale }: { s: Settings; sales: Sale[]; locale: string }) {
  const [index, setIndex] = useState(-1);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (closed) return;
    let i = 0;
    let hide: ReturnType<typeof setTimeout>;
    let timer: ReturnType<typeof setInterval>;
    const showNext = () => {
      setIndex(i % sales.length);
      track(TOOL_ID, "view");
      i++;
      hide = setTimeout(() => setIndex(-1), s.displaySeconds * 1000);
    };
    const first = setTimeout(() => {
      showNext();
      timer = setInterval(showNext, (s.intervalSeconds + s.displaySeconds) * 1000);
    }, s.firstDelaySeconds * 1000);
    return () => {
      clearTimeout(first);
      clearTimeout(hide);
      clearInterval(timer);
    };
  }, [closed]);

  const sale = index >= 0 ? sales[index] : undefined;
  if (!sale || closed) return null;
  const side = s.position === "bottom-right" ? "right" : "left";
  const quick = document.querySelector<HTMLElement>("#app-quick-links button[aria-controls]");
  const raise = quick && quick.style[side] ? 64 : 0;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        [side]: "16px",
        bottom: `${16 + bottomOffset() + raise}px`,
        zIndex: 2147482300,
        width: "min(340px, calc(100vw - 32px))",
        display: "flex",
        gap: "12px",
        alignItems: "center",
        padding: "10px 36px 10px 10px",
        borderRadius: "10px",
        background: s.colors.background,
        color: s.colors.text,
        boxShadow: "0 6px 24px rgba(0,0,0,.18)",
        fontSize: "14px",
      }}
    >
      {sale.image && (
        <img
          src={imageUrl(sale.image, 120)}
          alt=""
          width={56}
          height={56}
          style={{ borderRadius: "6px", objectFit: "cover", flex: "none" }}
        />
      )}
      <a
        href={sale.url}
        onClick={() => track(TOOL_ID, "click")}
        style={{ color: "inherit", textDecoration: "none" }}
      >
        <span style={{ display: "block" }}>{fill(s.saleMessage, { product: sale.title })}</span>
        <span style={{ display: "block", fontSize: "12px", opacity: 0.7, marginTop: "2px" }}>
          {timeAgo(sale.soldAt, Date.now(), locale)}
        </span>
      </a>
      <button
        type="button"
        aria-label={widgetT(locale, "close")}
        onClick={() => {
          try {
            sessionStorage.setItem(CLOSED_KEY, "1");
          } catch {
            // private mode
          }
          setClosed(true);
        }}
        style={{
          position: "absolute",
          top: "2px",
          right: "2px",
          border: 0,
          background: "none",
          color: "inherit",
          fontSize: "18px",
          minWidth: "32px",
          minHeight: "32px",
          cursor: "pointer",
        }}
      >
        ×
      </button>
    </div>
  );
}

/** সত্যিকারের সাম্প্রতিক বিক্রি; বিক্রি না থাকলে কিছুই দেখায় না */
export async function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (!s.showOnMobile && isMobile()) return;
  try {
    if (sessionStorage.getItem(CLOSED_KEY)) return;
  } catch {
    // private mode
  }
  const res = await fetch("/apps/app-tools/recent-sales").catch(() => null);
  if (!res?.ok) return;
  const { sales = [] } = (await res.json()) as { sales?: Sale[] };
  if (sales.length === 0) return;
  const host = document.createElement("div");
  host.id = "app-recent-sales";
  document.body.appendChild(host);
  render(<Toasts s={s} sales={sales} locale={config.locale} />, host);
}
