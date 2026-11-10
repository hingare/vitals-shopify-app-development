import { render } from "preact";
import type { ToolContext } from "../types";
import { track } from "../analytics";
import { isMobile, store } from "../dom";
import { PROXY, proxyGet, proxyPost } from "../proxy";
import { buttonStyle, type Colors } from "../ui";

const TOOL_ID = "push-notifications";
const HIDE_KEY = "app_push_hidden_until";
const SYNC_KEY = "app_push_sync_due";
const SEEN_KEY = "app_push_seen";
const DAY = 86_400_000;

interface Settings {
  promptTitle: string;
  promptBody: string;
  allowText: string;
  laterText: string;
  delaySeconds: number;
  frequencyDays: number;
  showOnMobile: boolean;
  colors: Colors;
}

/** সার্ভারের দেওয়া public চাবি (base64url) → বাইট */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** ব্রাউজারের বর্তমান গ্রাহকত্ব এই চাবি দিয়েই করা কিনা (চাবি বদলালে নতুন করে করতে হয়) */
export function sameKey(current: ArrayBuffer | null | undefined, wanted: Uint8Array): boolean {
  if (!current) return false;
  const have = new Uint8Array(current);
  return have.length === wanted.length && have.every((byte, i) => byte === wanted[i]);
}

/**
 * Service worker চালু হওয়া পর্যন্ত অপেক্ষা। স্টোরের পেজ এই worker-এর এলাকার (/apps/app-tools/) বাইরে,
 * তাই `navigator.serviceWorker.ready` কখনো শেষ হয় না; worker-এর নিজের অবস্থা দেখতে হয়।
 */
function activated(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return Promise.resolve();
  const worker = registration.installing ?? registration.waiting;
  return new Promise((resolve, reject) => {
    if (!worker) return reject(new Error("no worker"));
    const timer = setTimeout(() => reject(new Error("worker timeout")), 15_000);
    const check = () => {
      if (worker.state !== "activated" && worker.state !== "redundant") return;
      clearTimeout(timer);
      worker.removeEventListener("statechange", check);
      if (worker.state === "activated") resolve();
      else reject(new Error("worker failed"));
    };
    worker.addEventListener("statechange", check);
    check();
  });
}

/** ব্রাউজারকে গ্রাহক করে আর ঠিকানাটা আমাদের সার্ভারে জমা দেয়; সফল হলে true */
async function subscribe(): Promise<boolean> {
  const data = await proxyGet<{ key: string }>("push");
  if (!data?.key) return false;
  const key = keyBytes(data.key);
  const registration = await navigator.serviceWorker.register(`${PROXY}sw.js`, { scope: PROXY });
  await activated(registration);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  return (await proxyPost<{ ok: boolean }>("push", subscription.toJSON())).ok;
}

function Card({ s, allow, later }: { s: Settings; allow: () => void; later: () => void }) {
  return (
    <div
      role="dialog"
      aria-label={s.promptTitle}
      style={{
        position: "fixed",
        top: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147482600,
        width: "min(380px, calc(100vw - 32px))",
        boxSizing: "border-box",
        padding: "16px",
        borderRadius: "12px",
        background: s.colors.background,
        color: s.colors.text,
        boxShadow: "0 8px 30px rgba(0,0,0,.22)",
        fontSize: "14px",
        lineHeight: 1.45,
      }}
    >
      <strong style={{ display: "block", fontSize: "15px" }}>{s.promptTitle}</strong>
      {s.promptBody && <p style={{ margin: "6px 0 0" }}>{s.promptBody}</p>}
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "12px" }}>
        <button
          type="button"
          onClick={later}
          style={{ ...buttonStyle(s.colors, true), padding: "8px 14px", minHeight: "40px" }}
        >
          {s.laterText}
        </button>
        <button
          type="button"
          onClick={allow}
          style={{ ...buttonStyle(s.colors), padding: "8px 14px", minHeight: "40px" }}
        >
          {s.allowText}
        </button>
      </div>
    </div>
  );
}

/**
 * আগে নিজের ছোট কার্ডে জিজ্ঞেস করে; ক্রেতা রাজি হলে তবেই ব্রাউজারের অনুমতির প্রশ্ন আসে।
 * "Not now" বললে নির্দিষ্ট দিন আর জিজ্ঞেস করে না; ব্রাউজারে মানা করলে আর কখনো না।
 */
export function mount({ settings }: ToolContext) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return;
  const s = settings as unknown as Settings;

  if (Notification.permission === "granted") {
    // আগে থেকেই অনুমতি আছে: মাঝে মাঝে ঠিকানাটা মিলিয়ে নিই (ব্রাউজার সেটা বদলাতে পারে)
    if (Number(store.get(SYNC_KEY) ?? 0) > Date.now()) return;
    store.set(SYNC_KEY, String(Date.now() + DAY)); // ব্যর্থ হলে কাল আবার চেষ্টা
    void subscribe().then(
      (ok) => ok && store.set(SYNC_KEY, String(Date.now() + 7 * DAY)),
      () => undefined,
    );
    return;
  }
  if (Notification.permission !== "default") return;
  if (!s.showOnMobile && isMobile()) return;
  if (Number(store.get(HIDE_KEY) ?? 0) > Date.now()) return;
  // এক সেশনে একবারই দেখাই; প্রতি পেজে একই প্রশ্ন বিরক্তিকর
  try {
    if (sessionStorage.getItem(SEEN_KEY)) return;
  } catch {
    return;
  }

  setTimeout(() => {
    const host = document.createElement("div");
    host.id = "app-push-prompt";
    document.body.appendChild(host);
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // private mode
    }
    const close = () => {
      render(null, host);
      host.remove();
    };
    const snooze = () => store.set(HIDE_KEY, String(Date.now() + s.frequencyDays * DAY));
    const allow = async () => {
      close();
      // অনুমতির প্রশ্ন ক্রেতার ক্লিকের সাথেই যেতে হয়, নইলে ব্রাউজার সেটা আটকে দেয়
      const permission = await Notification.requestPermission().catch(() => "default" as const);
      if (permission !== "granted") return snooze();
      const ok = await subscribe().catch(() => false);
      if (!ok) return;
      track(TOOL_ID, "click");
      store.set(SYNC_KEY, String(Date.now() + 7 * DAY));
    };
    track(TOOL_ID, "view");
    render(
      <Card
        s={s}
        allow={() => void allow()}
        later={() => {
          snooze();
          close();
        }}
      />,
      host,
    );
  }, s.delaySeconds * 1000);
}
