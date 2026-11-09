import { render } from "preact";
import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { bottomOffset, isMobile } from "../dom";

const TOOL_ID = "chat-button";

type Channel = "whatsapp" | "messenger" | "telegram" | "phone" | "email";

interface Settings {
  channel: Channel;
  contact: string;
  greeting: string;
  label: string;
  position: "bottom-right" | "bottom-left";
  showOnMobile: boolean;
  colors: { background: string; text: string; accent: string };
}

/** মার্চেন্টের দেওয়া যোগাযোগ থেকে নিরাপদ লিংক; ভুল হলে null */
export function chatLink(channel: Channel, contact: string, greeting: string): string | null {
  const value = contact.trim();
  const digits = value.replace(/[^\d]/g, "");
  const user = value.replace(/^@/, "");
  const text = encodeURIComponent(greeting);
  switch (channel) {
    case "whatsapp":
      return digits.length >= 7
        ? `https://wa.me/${digits}${greeting ? `?text=${text}` : ""}`
        : null;
    case "phone":
      return digits.length >= 5 ? `tel:+${digits}` : null;
    case "messenger":
      return /^[\w.-]{2,100}$/.test(user) ? `https://m.me/${user}` : null;
    case "telegram":
      return /^\w{4,64}$/.test(user) ? `https://t.me/${user}` : null;
    case "email":
      return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(value)
        ? `mailto:${value}${greeting ? `?subject=${text}` : ""}`
        : null;
  }
}

const ICON: Record<"chat" | "phone" | "email", string> = {
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  phone:
    '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
};

/** স্ক্রিনের কোণে ভাসমান চ্যাট বাটন */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (!s.showOnMobile && isMobile()) return;
  const href = chatLink(s.channel, s.contact, s.greeting);
  if (!href) return;
  const host = document.createElement("div");
  host.id = "app-chat-button";
  document.body.appendChild(host);
  const side = s.position === "bottom-left" ? "left" : "right";
  const icon = s.channel === "phone" ? "phone" : s.channel === "email" ? "email" : "chat";
  const label = s.label || widgetT(config.locale, "chat");
  const showLabel = Boolean(s.label) && !isMobile();

  const draw = () =>
    render(
      <a
        href={href}
        {...(href.startsWith("https:") ? { target: "_blank", rel: "noopener" } : {})}
        aria-label={label}
        onClick={() => track(TOOL_ID, "click")}
        style={{
          position: "fixed",
          [side]: "20px",
          bottom: `${20 + bottomOffset()}px`,
          zIndex: 2147482500,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          minHeight: "52px",
          minWidth: "52px",
          justifyContent: "center",
          padding: showLabel ? "0 18px 0 14px" : 0,
          borderRadius: "26px",
          background: s.colors.background,
          color: s.colors.text,
          boxShadow: "0 4px 14px rgba(0,0,0,.2)",
          textDecoration: "none",
          fontSize: "15px",
          fontWeight: 600,
        }}
      >
        <svg
          aria-hidden="true"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
          dangerouslySetInnerHTML={{ __html: ICON[icon] }}
        />
        {showLabel && <span>{label}</span>}
      </a>,
      host,
    );
  draw();
  // Sticky ATC বা নিচের বার পরে এলে বাটন তার উপরে সরে যায়
  setTimeout(draw, 2500);
}
