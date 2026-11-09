import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { barHost, isMobile } from "../dom";

const TOOL_ID = "announcement-bar";

interface Settings {
  message1: string;
  message2: string;
  message3: string;
  link: string;
  rotateSeconds: number;
  position: "top" | "bottom";
  sticky: boolean;
  closable: boolean;
  showOnMobile: boolean;
  colors: { background: string; text: string; accent: string };
}

const CLOSED_KEY = "app_announcement_closed";

function Bar({ s, messages, locale }: { s: Settings; messages: string[]; locale: string }) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (messages.length < 2) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % messages.length),
      s.rotateSeconds * 1000,
    );
    return () => clearInterval(timer);
  }, [messages.length, s.rotateSeconds]);

  if (!open) return null;
  const text = messages[index];
  return (
    <div
      role="region"
      aria-label={messages[0]}
      style={{
        position: "relative",
        background: s.colors.background,
        color: s.colors.text,
        padding: s.closable ? "9px 40px" : "9px 16px",
        textAlign: "center",
        fontSize: "14px",
      }}
    >
      <span aria-live="polite">
        {s.link ? (
          <a
            href={s.link}
            onClick={() => track(TOOL_ID, "click")}
            style={{
              color: "inherit",
              textDecoration: "underline",
              textDecorationColor: s.colors.accent,
            }}
          >
            {text}
          </a>
        ) : (
          text
        )}
      </span>
      {s.closable && (
        <button
          type="button"
          aria-label={widgetT(locale, "close")}
          onClick={() => {
            try {
              sessionStorage.setItem(CLOSED_KEY, messages.join("|"));
            } catch {
              // private mode
            }
            setOpen(false);
          }}
          style={{
            position: "absolute",
            right: "4px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: 0,
            color: "inherit",
            fontSize: "20px",
            lineHeight: 1,
            cursor: "pointer",
            minWidth: "36px",
            minHeight: "36px",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** সব পেজের উপরে বা নিচে ঘোষণা; বন্ধ করলে এই ভিজিটে আর দেখায় না */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (!s.showOnMobile && isMobile()) return;
  const messages = [s.message1, s.message2, s.message3].filter((m) => m && m.trim());
  if (messages.length === 0) return;
  try {
    if (sessionStorage.getItem(CLOSED_KEY) === messages.join("|")) return;
  } catch {
    // private mode
  }
  track(TOOL_ID, "view");
  render(<Bar s={s} messages={messages} locale={config.locale} />, barHost(s.position, s.sticky));
}
