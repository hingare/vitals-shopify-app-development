import { render } from "preact";
import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { fill, store } from "../dom";
import { root } from "../product";

const KEY = "app_geo_dismissed";

interface Settings {
  geoMessage: string;
  switchText: string;
  stayText: string;
  customRedirects: string;
  colors: { background: string; text: string; accent: string };
}

/** "BD=https://bd.example.com" লাইনগুলো → দেশ → লিংক */
export function parseRedirects(text: string): Record<string, string> {
  const rules: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z]{2})\s*=\s*(https:\/\/\S+)\s*$/.exec(line);
    if (m) rules[m[1]!.toUpperCase()] = m[2]!;
  }
  return rules;
}

/** Markets-এ দেশ বদলানো: Shopify-র নিজের localization ফর্ম */
function switchCountry(code: string) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = `${root()}localization`;
  for (const [name, value] of Object.entries({
    form_type: "localization",
    _method: "put",
    country_code: code,
    return_to: location.pathname + location.search,
  })) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

/** ভিজিটরের দেশ অন্য হলে সেই দেশের স্টোরে যেতে বলে (নিজে থেকে কখনো সরায় না) */
export async function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const res = await fetch(`${root()}browsing_context_suggestions.json?country[enabled]=true`).catch(
    () => null,
  );
  if (!res?.ok) return;
  const data = (await res.json()) as {
    detected_values?: { country?: { handle?: string; name?: string } };
  };
  const visitor = data.detected_values?.country?.handle?.toUpperCase();
  if (!visitor || store.get(KEY) === visitor) return;

  const custom = parseRedirects(s.customRedirects)[visitor];
  let go: (() => void) | null = null;
  if (custom) {
    if (new URL(custom).host !== location.host) go = () => location.assign(custom);
  } else if (visitor !== config.country && config.countries?.includes(visitor)) {
    go = () => switchCountry(visitor);
  }
  if (!go) return;

  let name = data.detected_values?.country?.name ?? visitor;
  try {
    name = new Intl.DisplayNames([config.locale], { type: "region" }).of(visitor) ?? name;
  } catch {
    // পুরনো ব্রাউজার: Shopify-র দেওয়া নাম
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const close = () => {
    store.set(KEY, visitor);
    render(null, host);
    host.remove();
  };
  render(
    <div
      role="dialog"
      aria-label={name}
      style={{
        position: "fixed",
        top: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483150,
        width: "min(420px, calc(100vw - 32px))",
        padding: "16px",
        borderRadius: "12px",
        background: s.colors.background,
        color: s.colors.text,
        boxShadow: "0 8px 30px rgba(0,0,0,.25)",
        fontSize: "14px",
      }}
    >
      <p style={{ margin: "0 0 12px" }}>{fill(s.geoMessage, { country: name })}</p>
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={close}
          aria-label={`${s.stayText} (${widgetT(config.locale, "close")})`}
          style={{
            minHeight: "40px",
            padding: "0 14px",
            background: "none",
            border: 0,
            color: "inherit",
            cursor: "pointer",
          }}
        >
          {s.stayText}
        </button>
        <button
          type="button"
          onClick={() => {
            store.set(KEY, visitor);
            go!();
          }}
          style={{
            minHeight: "40px",
            padding: "0 16px",
            border: 0,
            borderRadius: "8px",
            background: s.colors.accent,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {s.switchText}
        </button>
      </div>
    </div>,
    host,
  );
}
