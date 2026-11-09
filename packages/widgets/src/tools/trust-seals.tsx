import { render } from "preact";
import type { ToolContext } from "../types";
import { type WidgetString, widgetT } from "../i18n";
import { track } from "../analytics";
import { placeAfterProductForm, placeNearCheckout } from "../product";

const TOOL_ID = "trust-seals";

type Badge =
  "secure-checkout" | "free-shipping" | "money-back" | "easy-returns" | "support" | "quality";

interface Settings {
  badges: Badge[];
  heading: string;
  iconSize: number;
  showOnCart: boolean;
  colors: { background: string; text: string; accent: string };
}

/** নিজেদের আঁকা সাধারণ আইকন (24x24, শুধু রেখা) */
const ICONS: Record<Badge, string> = {
  "secure-checkout":
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  "free-shipping":
    '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  "money-back":
    '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2-.5-2.5-1.5M12 6.5V8m0 8v1.5"/>',
  "easy-returns": '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/>',
  support:
    '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/>',
  quality:
    '<circle cx="12" cy="9" r="6"/><path d="m9 9 2 2 4-4"/><path d="M8.5 14 7 21l5-3 5 3-1.5-7"/>',
};

function Seals({ s, locale }: { s: Settings; locale: string }) {
  return (
    <div
      style={{
        margin: "16px 0",
        padding: "12px",
        borderRadius: "8px",
        background: s.colors.background,
        color: s.colors.text,
        textAlign: "center",
      }}
    >
      {s.heading && <p style={{ margin: "0 0 10px", fontWeight: 600 }}>{s.heading}</p>}
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "12px 20px",
        }}
      >
        {s.badges.map((badge) => (
          <li
            key={badge}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}
          >
            <svg
              aria-hidden="true"
              width={s.iconSize}
              height={s.iconSize}
              viewBox="0 0 24 24"
              fill="none"
              stroke={s.colors.accent}
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              dangerouslySetInnerHTML={{ __html: ICONS[badge] }}
            />
            <span style={{ fontSize: "12px" }}>{widgetT(locale, badge as WidgetString)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Add to cart-এর নিচে (বা কার্টে চেকআউটের কাছে) ভরসার ব্যাজ */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const badges = s.badges.filter((b) => b in ICONS);
  if (badges.length === 0) return;
  let host: HTMLElement;
  if (config.pageType === "product") host = placeAfterProductForm(TOOL_ID);
  else if (config.pageType === "cart" && s.showOnCart) host = placeNearCheckout(TOOL_ID);
  else return;
  track(TOOL_ID, "view");
  render(<Seals s={{ ...s, badges }} locale={config.locale} />, host);
}
