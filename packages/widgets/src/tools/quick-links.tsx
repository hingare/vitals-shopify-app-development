import { render } from "preact";
import { useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { track } from "../analytics";
import { bottomOffset, isMobile } from "../dom";

const TOOL_ID = "quick-links";

type Settings = Record<string, string> & {
  buttonText: string;
  position: "bottom-left" | "bottom-right";
  showOnMobile: boolean;
  colors: { background: string; text: string; accent: string };
};

export function links(s: Record<string, unknown>): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  for (let i = 1; i <= 5; i++) {
    const label = String(s[`link${i}Label`] ?? "").trim();
    const url = String(s[`link${i}Url`] ?? "").trim();
    if (label && /^(https:\/\/|\/)/.test(url)) out.push({ label, url });
  }
  return out;
}

function Menu({ s, items }: { s: Settings; items: Array<{ label: string; url: string }> }) {
  const [open, setOpen] = useState(false);
  const side = s.position === "bottom-right" ? "right" : "left";
  const bottom = 20 + bottomOffset();
  return (
    <div onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      {open && (
        <ul
          id="app-quick-links-menu"
          style={{
            position: "fixed",
            [side]: "20px",
            bottom: `${bottom + 56}px`,
            zIndex: 2147482400,
            listStyle: "none",
            margin: 0,
            padding: "6px",
            minWidth: "200px",
            borderRadius: "10px",
            background: "#fff",
            color: "#111827",
            boxShadow: "0 6px 24px rgba(0,0,0,.18)",
          }}
        >
          {items.map((item) => (
            <li key={item.url}>
              <a
                href={item.url}
                onClick={() => track(TOOL_ID, "click")}
                style={{
                  display: "block",
                  padding: "10px 12px",
                  color: "inherit",
                  textDecoration: "none",
                  borderRadius: "6px",
                }}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="app-quick-links-menu"
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed",
          [side]: "20px",
          bottom: `${bottom}px`,
          zIndex: 2147482400,
          minHeight: "44px",
          padding: "0 16px",
          border: 0,
          borderRadius: "22px",
          background: s.colors.background,
          color: s.colors.text,
          boxShadow: "0 4px 14px rgba(0,0,0,.2)",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: 600,
        }}
      >
        {open ? "×" : "☰"} {s.buttonText}
      </button>
    </div>
  );
}

export function mount({ settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (!s.showOnMobile && isMobile()) return;
  const items = links(settings);
  if (items.length === 0) return;
  const host = document.createElement("div");
  host.id = "app-quick-links";
  document.body.appendChild(host);
  render(<Menu s={s} items={items} />, host);
}
