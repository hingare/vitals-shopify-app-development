import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { track } from "../analytics";
import { bottomOffset, isMobile, store } from "../dom";
import { widgetT, type WidgetString } from "../i18n";
import { proxyPost } from "../proxy";
import type { StoreConfig, ToolContext } from "../types";
import { inputStyle, type Colors } from "../ui";

/**
 * Live Chat: স্টোরের কোণে চ্যাটের বোতাম; ক্রেতা লেখেন, মার্চেন্ট অ্যাপের Chat পাতা থেকে উত্তর দেন।
 * - ব্রাউজার প্রথম বার্তার সময় একটা গোপন চাবি বানিয়ে রাখে; সেই চাবি দিয়েই শুধু নিজের কথোপকথন পড়া যায়।
 * - চ্যাট খোলা থাকলে কয়েক সেকেন্ড পরপর নতুন উত্তর দেখে, বন্ধ থাকলে (আগে লিখে থাকলে) আধা মিনিট পরপর,
 *   আর পেজ সামনে না থাকলে একেবারেই না, তাই সার্ভারে চাপ কম।
 * - মার্চেন্ট অনলাইন না থাকলে তাঁর দূরে থাকার বার্তা দেখায় আর (সেটিংস অনুযায়ী) উত্তরের জন্য ইমেইল চায়।
 */
const TOOL_ID = "live-chat";
const KEY_STORE = "app_chat_key";
const SEEN_STORE = "app_chat_seen";
const OPEN_POLL_MS = 4_000;
const IDLE_POLL_MS = 30_000;
const MESSAGE_MAX = 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type AskEmail = "always" | "offline" | "never";

interface Settings {
  title: string;
  welcomeMessage: string;
  offlineText: string;
  askEmail: AskEmail;
  position: "bottom-right" | "bottom-left";
  showOnMobile: boolean;
  colors: Colors;
}

export interface ChatMessage {
  id: string;
  from: "visitor" | "store";
  body: string;
  at: string;
}

interface Thread {
  online: boolean;
  messages: ChatMessage[];
  hasEmail: boolean;
}

/** ৩২ বাইটের র‍্যান্ডম চাবি (URL-নিরাপদ base64, ৪৩ অক্ষর) */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** নতুন বার্তা আগেরগুলোর সাথে মেশায়: একই বার্তা একবার, সময়ের ক্রমে */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at));
}

/** উত্তর পাওয়ার জন্য এখন ইমেইল চাইতে হবে কিনা (অনলাইন কিনা না জানা পর্যন্ত চাওয়া হয় না) */
export function needsEmail(askEmail: AskEmail, online: boolean | null, hasEmail: boolean) {
  return !hasEmail && (askEmail === "always" || (askEmail === "offline" && online === false));
}

/** ক্রেতা শেষবার দেখার পরে মার্চেন্টের কয়টা নতুন উত্তর এসেছে */
export function unreadSince(messages: ChatMessage[], seenAt: string | null): number {
  return messages.filter((message) => message.from === "store" && (!seenAt || message.at > seenAt))
    .length;
}

/** পেজ বদলালেও একই চাবি; localStorage বন্ধ থাকলে অন্তত এই পেজে একটাই */
let memoryKey: string | null = null;
const currentKey = () => (memoryKey ??= store.get(KEY_STORE));
function ensureKey(): string {
  const existing = currentKey();
  if (existing) return existing;
  memoryKey = newKey();
  store.set(KEY_STORE, memoryKey);
  return memoryKey;
}

type T = (key: WidgetString) => string;

function Bubble({ mine, text, colors }: { mine: boolean; text: string; colors: Colors }) {
  return (
    <li
      style={{
        alignSelf: mine ? "flex-end" : "flex-start",
        maxWidth: "85%",
        padding: "8px 12px",
        borderRadius: mine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        background: mine ? colors.accent : "rgba(0,0,0,.06)",
        color: mine ? "#fff" : "inherit",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    >
      {text}
    </li>
  );
}

function Chat({ s, t, config }: { s: Settings; t: T; config: StoreConfig }) {
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasEmail, setHasEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<WidgetString | null>(null);
  const [active, setActive] = useState(() => Boolean(currentKey()));
  const [seen, setSeen] = useState(() => store.get(SEEN_STORE));
  const [offset, setOffset] = useState(bottomOffset());
  const list = useRef<HTMLUListElement>(null);
  const latest = useRef({ open, messages });
  latest.current = { open, messages };
  const side = s.position === "bottom-left" ? "left" : "right";
  const mobile = isMobile();
  const askForEmail = needsEmail(s.askEmail, online, hasEmail);
  const unread = open ? 0 : unreadSince(messages, seen);

  async function refresh(full: boolean) {
    const last = latest.current.messages[latest.current.messages.length - 1];
    const res = await proxyPost<Thread>("chat", {
      action: "read",
      key: currentKey() ?? undefined,
      since: full ? undefined : last?.at,
      open: latest.current.open,
    });
    if (!res.ok || !res.data) return;
    setOnline(res.data.online);
    setHasEmail(res.data.hasEmail);
    const incoming = res.data.messages;
    setMessages((previous) => mergeMessages(previous, incoming));
  }

  useEffect(() => {
    // Sticky ATC বা নিচের বার পরে এলে বোতাম তার উপরে সরে যায়
    const timer = setTimeout(() => setOffset(bottomOffset()), 2500);
    // ইমেইলের "Continue the chat" লিংক থেকে এলে চ্যাট খোলা অবস্থায়
    if (/[?&]app_chat=open\b/.test(location.search) || location.hash === "#chat") setOpen(true);
    return () => clearTimeout(timer);
  }, []);

  // খোলা থাকলে ঘনঘন, বন্ধ থাকলে (আগে লিখে থাকলে) মাঝে মাঝে; পেজ পেছনে থাকলে নয়
  useEffect(() => {
    if (!open && !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const tick = async () => {
      if (document.visibilityState === "visible") await refresh(first);
      first = false;
      if (!stopped) timer = setTimeout(() => void tick(), open ? OPEN_POLL_MS : IDLE_POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    list.current?.scrollTo({ top: list.current.scrollHeight });
    const last = messages[messages.length - 1];
    if (last && last.at !== seen) {
      setSeen(last.at);
      store.set(SEEN_STORE, last.at);
    }
  }, [open, messages]);

  function toggle() {
    if (!open) track(TOOL_ID, "view");
    setOpen(!open);
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    if (askForEmail && !EMAIL.test(email.trim())) {
      setError(email.trim() ? "chatEmailInvalid" : "chatEmailNeeded");
      return;
    }
    setSending(true);
    setError(null);
    const res = await proxyPost<{ message: ChatMessage; online: boolean }>("chat", {
      action: "send",
      key: ensureKey(),
      text: body,
      email: email.trim() || undefined,
      page: location.pathname,
      locale: config.locale,
    });
    setSending(false);
    const data = res.data;
    if (res.ok && data?.message) {
      setMessages((previous) => mergeMessages(previous, [data.message]));
      setOnline(data.online);
      if (email.trim()) setHasEmail(true);
      setText("");
      setActive(true);
      track(TOOL_ID, "click");
      return;
    }
    if (data?.error === "email_required") setOnline(false);
    setError(
      data?.error === "email_required"
        ? "chatEmailNeeded"
        : data?.error === "invalid_email"
          ? "chatEmailInvalid"
          : res.status === 429
            ? "tooMany"
            : "tryAgain",
    );
  }

  const field = { ...inputStyle, padding: "10px 12px", minHeight: "40px" };

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label={s.title}
          style={{
            position: "fixed",
            zIndex: 2147482600,
            ...(mobile
              ? { inset: 0 }
              : {
                  [side]: "20px",
                  bottom: `${92 + offset}px`,
                  width: "360px",
                  height: `min(560px, calc(100vh - ${120 + offset}px))`,
                  borderRadius: "12px",
                }),
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: s.colors.background,
            color: s.colors.text,
            boxShadow: "0 10px 40px rgba(0,0,0,.25)",
            fontSize: "15px",
            lineHeight: 1.4,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "12px 8px 12px 16px",
              background: s.colors.accent,
              color: "#fff",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: "block" }}>{s.title}</strong>
              {online !== null && (
                <span style={{ fontSize: "13px", opacity: 0.9 }}>
                  {online ? `● ${t("chatOnline")}` : t("chatAway")}
                </span>
              )}
            </div>
            <button
              type="button"
              aria-label={t("close")}
              onClick={() => setOpen(false)}
              style={{
                background: "none",
                border: 0,
                color: "inherit",
                fontSize: "26px",
                minWidth: "44px",
                minHeight: "44px",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
          {online === false && s.offlineText && (
            <p
              style={{
                margin: 0,
                padding: "8px 16px",
                fontSize: "14px",
                background: "rgba(0,0,0,.04)",
              }}
            >
              {s.offlineText}
            </p>
          )}
          <ul
            ref={list}
            aria-live="polite"
            style={{
              flex: 1,
              overflowY: "auto",
              listStyle: "none",
              margin: 0,
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {s.welcomeMessage && <Bubble mine={false} text={s.welcomeMessage} colors={s.colors} />}
            {messages.map((message) => (
              <Bubble
                key={message.id}
                mine={message.from === "visitor"}
                text={message.body}
                colors={s.colors}
              />
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              padding: "12px",
              borderTop: "1px solid rgba(0,0,0,.1)",
            }}
          >
            {askForEmail && (
              <>
                <input
                  type="email"
                  autocomplete="email"
                  value={email}
                  onInput={(event) => setEmail(event.currentTarget.value)}
                  placeholder={t("emailPlaceholder")}
                  aria-label={t("emailPlaceholder")}
                  style={field}
                />
                <span style={{ fontSize: "12px", opacity: 0.7 }}>{t("chatEmailNote")}</span>
              </>
            )}
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
              <textarea
                value={text}
                rows={2}
                maxLength={MESSAGE_MAX}
                onInput={(event) => setText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={t("chatPlaceholder")}
                aria-label={t("chatPlaceholder")}
                style={{ ...field, flex: 1, resize: "none" }}
              />
              <button
                type="submit"
                disabled={sending || !text.trim()}
                style={{
                  background: s.colors.accent,
                  color: "#fff",
                  border: 0,
                  borderRadius: "8px",
                  minHeight: "44px",
                  padding: "0 16px",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  opacity: sending || !text.trim() ? 0.6 : 1,
                }}
              >
                {t("chatSend")}
              </button>
            </div>
            {error && (
              <span role="alert" style={{ fontSize: "13px", color: "#b42318" }}>
                {t(error)}
              </span>
            )}
          </form>
        </div>
      )}
      {!(open && mobile) && (
        <button
          type="button"
          aria-label={s.title}
          aria-expanded={open}
          onClick={toggle}
          style={{
            position: "fixed",
            [side]: "20px",
            bottom: `${20 + offset}px`,
            zIndex: 2147482500,
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            border: 0,
            background: s.colors.accent,
            color: "#fff",
            boxShadow: "0 4px 14px rgba(0,0,0,.2)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            aria-hidden="true"
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
          >
            {open ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 5h16v11H9l-5 4z" />}
          </svg>
          {unread > 0 && (
            <span
              aria-label={String(unread)}
              style={{
                position: "absolute",
                top: "-2px",
                [side === "right" ? "left" : "right"]: "-2px",
                minWidth: "20px",
                height: "20px",
                borderRadius: "10px",
                background: "#d72c0d",
                color: "#fff",
                fontSize: "12px",
                lineHeight: "20px",
                fontWeight: 700,
              }}
            >
              {unread}
            </span>
          )}
        </button>
      )}
    </>
  );
}

export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (!s.showOnMobile && isMobile()) return;
  const host = document.createElement("div");
  host.id = "app-live-chat";
  document.body.appendChild(host);
  const t: T = (key) => widgetT(config.locale, key);
  render(<Chat s={s} t={t} config={config} />, host);
}
