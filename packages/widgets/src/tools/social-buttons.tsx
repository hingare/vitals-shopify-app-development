import { render } from "preact";
import { useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { placeAfterProductForm } from "../product";

const TOOL_ID = "social-buttons";

type Network = "facebook" | "x" | "pinterest" | "whatsapp" | "email" | "copy";

interface Settings {
  networks: Network[];
  heading: string;
  colors: { background: string; text: string; accent: string };
}

const NAMES: Record<Exclude<Network, "copy">, string> = {
  facebook: "Facebook",
  x: "X",
  pinterest: "Pinterest",
  whatsapp: "WhatsApp",
  email: "Email",
};

/** প্রতিটি নেটওয়ার্কের নিজের শেয়ার লিংক (কোনো থার্ড-পার্টি স্ক্রিপ্ট লোড হয় না) */
export function shareUrl(
  network: Exclude<Network, "copy">,
  url: string,
  title: string,
  image = "",
) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  switch (network) {
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case "x":
      return `https://x.com/intent/post?url=${u}&text=${t}`;
    case "pinterest":
      return `https://pinterest.com/pin/create/button/?url=${u}&description=${t}${image ? `&media=${encodeURIComponent(image)}` : ""}`;
    case "whatsapp":
      return `https://wa.me/?text=${t}%20${u}`;
    case "email":
      return `mailto:?subject=${t}&body=${u}`;
  }
}

function Buttons({ s, locale }: { s: Settings; locale: string }) {
  const [copied, setCopied] = useState(false);
  const url = location.origin + location.pathname;
  const title = document.title;
  const image = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content ?? "";
  const pill = {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "36px",
    padding: "0 14px",
    borderRadius: "18px",
    border: 0,
    background: s.colors.background,
    color: s.colors.text,
    fontSize: "13px",
    textDecoration: "none",
    cursor: "pointer",
  };
  return (
    <div
      style={{
        margin: "12px 0",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px",
      }}
    >
      {s.heading && <span style={{ fontWeight: 600, marginRight: "4px" }}>{s.heading}</span>}
      {s.networks.map((network) =>
        network === "copy" ? (
          <button
            key={network}
            type="button"
            style={pill}
            onClick={() => {
              track(TOOL_ID, "click");
              void navigator.clipboard?.writeText(url).then(() => setCopied(true));
            }}
          >
            <span aria-live="polite">
              {copied ? widgetT(locale, "linkCopied") : widgetT(locale, "copyLink")}
            </span>
          </button>
        ) : network in NAMES ? (
          <a
            key={network}
            href={shareUrl(network, url, title, image)}
            target="_blank"
            rel="noopener"
            aria-label={`${widgetT(locale, "share")} ${NAMES[network]}`}
            onClick={() => track(TOOL_ID, "click")}
            style={pill}
          >
            {NAMES[network]}
          </a>
        ) : null,
      )}
    </div>
  );
}

/** প্রোডাক্ট শেয়ার করার বাটন */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType !== "product" || s.networks.length === 0) return;
  render(<Buttons s={s} locale={config.locale} />, placeAfterProductForm(TOOL_ID));
}
