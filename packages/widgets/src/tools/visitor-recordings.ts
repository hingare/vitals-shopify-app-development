import { isMobile, sessionStore } from "../dom";
import { newKey } from "../keys";
import { loadPrivacyApi } from "../privacy";
import { PROXY, proxyPost } from "../proxy";
import type { RecordedEvent } from "../recorder";
import type { ToolContext } from "../types";

/**
 * Visitor Recordings: ক্রেতা কীভাবে স্টোর ঘুরলেন তার রিপ্লের জন্য পেজের পরিবর্তন রেকর্ড করে (rrweb)।
 * - শুধু অ্যানালিটিক্সে রাজি ভিজিটর (Shopify-র Customer Privacy API), আর সেটিংসের শতাংশ অনুযায়ী বাছাই করা ভিজিট।
 * - ইনপুটে লেখা সবসময় ঢাকা; চাইলে পেজের সব লেখাও। অ্যাকাউন্ট, পাসওয়ার্ড আর অ্যাপের পাতা কখনো রেকর্ড হয় না।
 * - ভারী রেকর্ডার শুধু বাছাই হওয়া ভিজিটরের ব্রাউজারে আলাদা ফাইল থেকে আসে; বাকিদের কাছে এই ছোট ফাইলটাই।
 * - কয়েক সেকেন্ড পরপর ছোট অংশে (gzip) সার্ভারে যায়; মাসিক সীমা ফুরালে বা রেকর্ড খুব বড় হলে সার্ভার থামতে বলে।
 * একই ট্যাবে পেজ বদলালেও একটাই রেকর্ডিং চলে; ৩০ মিনিট কিছু না হলে পরের ভিজিট নতুন রেকর্ডিং।
 */
const PICK_KEY = "app_rec_pick"; // "0" এই ভিজিটে নয়, "s" বাছাই হয়েছে, "1" সার্ভারও রাজি
const STATE_KEY = "app_rec";
const SESSION_IDLE_MS = 30 * 60_000;
const FLUSH_MS = 10_000;
/** পেজ ছাড়ার সময় sendBeacon-এ যতটুকু নিশ্চিতভাবে যায় */
const BEACON_MAX = 60_000;
/** সার্ভার এর চেয়ে বড় অংশ নেয় না (gzip-এর পরে, base64-এ) */
const DATA_MAX = 690_000;
const BUFFER_MAX = 5_000;
/** এই পাতাগুলোতে ক্রেতার ব্যক্তিগত তথ্য থাকে, তাই কখনো রেকর্ড নয় */
const ALWAYS_SKIP = /^\/(?:account|apps|challenge|checkout|checkouts|orders|password)(?:\/|$)/i;
/** আমাদের যে উইজেটে ক্রেতার নিজের লেখা দেখায় (চ্যাটের বার্তা), আর মার্চেন্ট যা নিজে ঢাকতে চান */
const PRIVATE_TEXT = "#app-live-chat, [data-app-mask], .app-mask";

interface Settings {
  samplePercent: number;
  minSeconds: number;
  maskText: boolean;
  recordMobile: boolean;
  excludePaths: string;
}

/** এই ট্যাবের চলতি রেকর্ডিং: চাবি, পরের অংশের নম্বর, শুরু, শেষ কাজের সময়, থামানো কিনা */
export interface RecState {
  k: string;
  n: number;
  t0: number;
  t: number;
  x?: 1;
}

export const sampled = (percent: number, random = Math.random()) => random * 100 < percent;

/** ভাষার অংশ বাদ দিয়ে পথ ("/fr/account" → "/account"), যাতে বাদের নিয়ম সব ভাষায় খাটে */
export function canonicalPath(path: string, root = "/"): string {
  if (root === "/" || !root.endsWith("/")) return path;
  if (path === root.slice(0, -1)) return "/";
  return path.startsWith(root) ? path.slice(root.length - 1) : path;
}

/** এই পাতা রেকর্ড হবে না: সবসময় বাদের পাতা, বা মার্চেন্টের দেওয়া পথ (নিজে বা তার নিচের পাতা) */
export function excluded(path: string, list: string): boolean {
  if (ALWAYS_SKIP.test(path)) return true;
  return list
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter((prefix) => prefix.startsWith("/") && prefix.length > 1)
    .some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** রিপ্লেতে পাতার ঠিকানা থাকে, কিন্তু লিংকের ?…  আর #… নয় (সেখানে ইমেইল বা টোকেন থাকতে পারে) */
export function cleanHref(href: string): string {
  try {
    const url = new URL(href);
    return url.origin + url.pathname;
  } catch {
    return "";
  }
}

export function readState(raw: string | null, now: number): RecState | null {
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as Partial<RecState>;
    const valid =
      typeof state.k === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(state.k) &&
      Number.isInteger(state.n) &&
      (state.n ?? -1) >= 0 &&
      typeof state.t0 === "number" &&
      typeof state.t === "number";
    if (!valid || now - (state.t as number) > SESSION_IDLE_MS) return null;
    return state as RecState;
  } catch {
    return null;
  }
}

export async function gzipBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

type Stop = () => void;

async function record(s: Settings, path: string, approved: boolean): Promise<Stop | null> {
  if (!approved) {
    const res = await proxyPost<{ ok: boolean }>("recordings", { action: "start" });
    const ok = Boolean(res.ok && res.data?.ok);
    sessionStore.set(PICK_KEY, ok ? "1" : "0");
    if (!ok) return null;
  }
  const now = Date.now();
  const state = readState(sessionStore.get(STATE_KEY), now) ?? {
    k: newKey(),
    n: 0,
    t0: now,
    t: now,
  };
  if (state.x) return null;
  const save = () => {
    state.t = Date.now();
    sessionStore.set(STATE_KEY, JSON.stringify(state));
  };
  save();

  const { startRecorder } = await import("../recorder");
  const device = isMobile() ? "mobile" : "desktop";
  const minMs = s.minSeconds * 1000;
  const qualified = () => Date.now() - state.t0 >= minMs;
  let buffer: RecordedEvent[] = [];
  let stopped = false;
  let stopRecorder: Stop = () => {};
  let timer: ReturnType<typeof setInterval> | undefined;

  const halt = (forVisit: boolean) => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    stopRecorder();
    buffer = [];
    if (forVisit) {
      state.x = 1;
      save();
    }
  };

  const send = async (events: RecordedEvent[]) => {
    const seq = state.n++;
    save();
    const data = await gzipBase64(JSON.stringify(events));
    if (data.length > DATA_MAX) return halt(true);
    const res = await proxyPost<{ ok?: boolean; stop?: string }>("recordings", {
      action: "chunk",
      key: state.k,
      seq,
      page: path,
      device,
      data,
    });
    if (res.data?.stop) halt(true);
  };

  const flush = () => {
    if (stopped || buffer.length === 0 || !qualified()) return;
    const events = buffer;
    buffer = [];
    void send(events);
  };

  // পেজ ছাড়ার মুহূর্তে অপেক্ষা করা যায় না, তাই শেষ অংশ gzip ছাড়াই sendBeacon-এ (ছোট হলে)
  const leave = () => {
    if (stopped || buffer.length === 0 || !qualified()) return;
    const body = JSON.stringify({
      action: "chunk",
      key: state.k,
      seq: state.n,
      page: path,
      device,
      events: buffer,
    });
    buffer = [];
    if (body.length <= BEACON_MAX && navigator.sendBeacon(`${PROXY}recordings`, body)) state.n++;
    save();
  };

  stopRecorder = startRecorder(
    (event) => {
      if (stopped) return;
      if (event.type === 4) {
        const data = event.data as { href?: string } | undefined;
        if (data?.href) data.href = cleanHref(data.href);
      }
      buffer.push(event);
      // প্রতিটা পাতার শুরুর ছবি (full snapshot) সাথে সাথেই যায়, যাতে ছোট ভিজিটও পুরো রিপ্লে হয়
      if (event.type === 2) flush();
      if (buffer.length >= BUFFER_MAX) {
        if (qualified()) flush();
        else halt(false);
      }
    },
    s.maskText ? "*" : PRIVATE_TEXT,
  );
  timer = setInterval(flush, FLUSH_MS);
  const wait = state.t0 + minMs - Date.now();
  if (wait > 0) setTimeout(flush, wait + 50);
  addEventListener("pagehide", leave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave();
  });
  return () => halt(false);
}

export async function mount({ settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const path = canonicalPath(location.pathname, window.Shopify?.routes?.root ?? "/");
  if (excluded(path, s.excludePaths ?? "") || (!s.recordMobile && isMobile())) return;
  if (typeof CompressionStream === "undefined" || typeof navigator.sendBeacon !== "function") {
    return;
  }
  let pick = sessionStore.get(PICK_KEY);
  if (pick !== "s" && pick !== "1") {
    if (pick === "0") return;
    pick = sampled(s.samplePercent) ? "s" : "0";
    sessionStore.set(PICK_KEY, pick);
    if (pick === "0") return;
  }
  const approved = pick === "1";

  let stop: Stop | null = null;
  let starting = false;
  const begin = () => {
    if (stop || starting) return;
    starting = true;
    void record(s, path, approved).then((fn) => {
      stop = fn;
    });
  };
  // ক্রেতা পরে সম্মতি দিলে তখন শুরু, আর সম্মতি তুলে নিলে সাথে সাথে থামে
  document.addEventListener("visitorConsentCollected", (event) => {
    const detail = (event as CustomEvent<{ analyticsAllowed?: boolean }>).detail;
    if (detail?.analyticsAllowed) begin();
    else if (detail) {
      stop?.();
      stop = null;
    }
  });
  const privacy = await loadPrivacyApi();
  if (privacy?.analyticsProcessingAllowed?.()) begin();
}
