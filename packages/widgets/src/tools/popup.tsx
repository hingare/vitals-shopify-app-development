import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { isMobile, store } from "../dom";

const TOOL_ID = "popup";
const HIDE_KEY = "app_popup_hidden_until";
const DAY = 86_400_000;

interface Settings {
  trigger: "delay" | "exit" | "scroll";
  delaySeconds: number;
  scrollPercent: number;
  showOn: "everywhere" | "home" | "product";
  heading: string;
  body: string;
  collectEmail: boolean;
  buttonText: string;
  buttonLink: string;
  discountCode: string;
  successText: string;
  frequencyDays: number;
  showOnMobile: boolean;
  colors: { background: string; text: string; accent: string };
}

/** Shopify-র নিজের নিউজলেটার ফর্মে পাঠায়: ক্রেতা "subscribed" কাস্টমার হিসেবে Shopify-তে জমা হয় */
async function subscribe(email: string): Promise<"ok" | "failed"> {
  const body = new URLSearchParams({
    form_type: "customer",
    utf8: "✓",
    "contact[email]": email,
    "contact[tags]": "newsletter,popup",
  });
  try {
    const res = await fetch("/contact", { method: "POST", body });
    // Shopify বট ঠেকাতে মাঝে মাঝে captcha চায়: তখন ক্রেতাকে সেই পেজে পাঠাই, সেখান থেকে ফিরে আসবে
    if (res.url.includes("/challenge")) {
      location.href = res.url;
      return "ok";
    }
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

function Popup({ s, locale, onClose }: { s: Settings; locale: string; onClose: () => void }) {
  const [state, setState] = useState<"form" | "sending" | "done" | "failed">("form");
  const [copied, setCopied] = useState(false);
  const first = useRef<HTMLInputElement | HTMLAnchorElement | HTMLButtonElement>(null);
  const t = (key: Parameters<typeof widgetT>[1]) => widgetT(locale, key);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  async function submit(e: Event) {
    e.preventDefault();
    const email = (new FormData(e.currentTarget as HTMLFormElement).get("email") as string).trim();
    setState("sending");
    const result = await subscribe(email);
    if (result === "ok") {
      track(TOOL_ID, "click");
      store.set(HIDE_KEY, String(Date.now() + 365 * DAY));
    }
    setState(result === "ok" ? "done" : "failed");
  }

  const button = {
    background: s.colors.accent,
    color: "#fff",
    border: 0,
    borderRadius: "8px",
    padding: "12px 18px",
    minHeight: "44px",
    fontSize: "15px",
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
  };

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483100,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-popup-heading"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "420px",
          padding: "32px 24px 24px",
          borderRadius: "12px",
          background: s.colors.background,
          color: s.colors.text,
          textAlign: "center",
          boxShadow: "0 10px 40px rgba(0,0,0,.25)",
        }}
      >
        <button
          type="button"
          aria-label={t("close")}
          onClick={onClose}
          style={{
            position: "absolute",
            top: "6px",
            right: "6px",
            background: "none",
            border: 0,
            color: "inherit",
            fontSize: "24px",
            minWidth: "40px",
            minHeight: "40px",
            cursor: "pointer",
          }}
        >
          ×
        </button>
        <h2 id="app-popup-heading" style={{ margin: "0 0 8px", fontSize: "22px" }}>
          {s.heading}
        </h2>
        {state === "done" ? (
          <div>
            <p>{s.successText}</p>
            {s.discountCode && (
              <button
                type="button"
                style={{
                  ...button,
                  background: "none",
                  color: "inherit",
                  border: `2px dashed ${s.colors.accent}`,
                }}
                onClick={() => {
                  void navigator.clipboard?.writeText(s.discountCode).then(() => setCopied(true));
                }}
              >
                <strong>{s.discountCode}</strong> · {copied ? t("copied") : t("copy")}
              </button>
            )}
          </div>
        ) : (
          <div>
            {s.body && <p style={{ margin: "0 0 16px" }}>{s.body}</p>}
            {s.collectEmail ? (
              <form
                onSubmit={submit}
                style={{ display: "flex", flexDirection: "column", gap: "10px" }}
              >
                <input
                  ref={first as never}
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  aria-label={t("emailPlaceholder")}
                  placeholder={t("emailPlaceholder")}
                  style={{
                    padding: "12px",
                    minHeight: "44px",
                    borderRadius: "8px",
                    border: "1px solid rgba(0,0,0,.25)",
                    fontSize: "16px",
                  }}
                />
                <button type="submit" disabled={state === "sending"} style={button}>
                  {s.buttonText}
                </button>
                {state === "failed" && (
                  <p role="alert" style={{ margin: 0, color: "#B91C1C" }}>
                    {t("subscribeFailed")}
                  </p>
                )}
              </form>
            ) : s.buttonLink ? (
              <a
                ref={first as never}
                href={s.buttonLink}
                onClick={() => track(TOOL_ID, "click")}
                style={button}
              >
                {s.buttonText}
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** ঠিক সময়ে একবার পপ-আপ দেখায়; বন্ধ করলে কয়েক দিন আর দেখায় না */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (!s.showOnMobile && isMobile()) return;
  if (s.showOn === "home" && config.pageType !== "index") return;
  if (s.showOn === "product" && config.pageType !== "product") return;
  if (Number(store.get(HIDE_KEY) ?? 0) > Date.now()) return;
  if (!s.collectEmail && !s.buttonLink && !s.body) return;

  let shown = false;
  const show = () => {
    if (shown) return;
    shown = true;
    cleanup();
    const host = document.createElement("div");
    host.id = "app-popup";
    document.body.appendChild(host);
    track(TOOL_ID, "view");
    const close = () => {
      if (Number(store.get(HIDE_KEY) ?? 0) < Date.now() + s.frequencyDays * DAY) {
        store.set(HIDE_KEY, String(Date.now() + s.frequencyDays * DAY));
      }
      render(null, host);
      host.remove();
    };
    render(<Popup s={s} locale={config.locale} onClose={close} />, host);
  };

  const onLeave = (e: MouseEvent) => {
    if (e.clientY <= 0 && !e.relatedTarget) show();
  };
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    if (max <= 0 || (scrollY / max) * 100 >= s.scrollPercent) show();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(timer);
    document.removeEventListener("mouseout", onLeave);
    removeEventListener("scroll", onScroll);
  };

  // মোবাইলে "পেজ ছেড়ে যাওয়া" বোঝা যায় না, তাই সেখানে কয়েক সেকেন্ড পরে দেখায়
  const trigger = s.trigger === "exit" && isMobile() ? "delay" : s.trigger;
  if (trigger === "delay") timer = setTimeout(show, s.delaySeconds * 1000);
  else if (trigger === "exit") document.addEventListener("mouseout", onLeave);
  else addEventListener("scroll", onScroll, { passive: true });
}
