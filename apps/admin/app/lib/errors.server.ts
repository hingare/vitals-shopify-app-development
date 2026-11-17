import { createHash } from "node:crypto";
import db from "../db.server";
import type { ErrorSource } from "./errors";

/**
 * অ্যাপের নিজের ত্রুটির খাতা: Sentry-র মতো, কিন্তু নিজের ডাটাবেসে, তাই খরচ বা বাইরের অ্যাকাউন্ট লাগে না
 * আর কোনো তথ্য বাইরে যায় না।
 *
 * - কোথা থেকে আসে: সার্ভারের পাতা আর রাস্তা (entry.server-এর handleError), সব চেষ্টার পরেও ব্যর্থ ব্যাকগ্রাউন্ড
 *   কাজ (queue.server, Speed Guard), ব্যর্থ webhook (retryWebhook), আর অ্যাডমিনে ব্রাউজারে ভাঙা পাতা (/app/errors)।
 * - একই ধরনের ত্রুটি এক সারিতে গোনা হয়: চাবি (fingerprint) বানানোর সময় বার্তার সংখ্যা আর id বাদ যায়, তাই
 *   "order 123 failed" আর "order 456 failed" একই ত্রুটি।
 * - জমার আগে ইমেইল, ফোন নম্বর, লম্বা সংখ্যা আর চাবি/টোকেন মুছে ফেলা হয়; Prisma-র বার্তা থেকে query-র মান বাদ যায়।
 * - একই ত্রুটি ঝাঁকে ঝাঁকে এলে ডাটাবেসে চাপ না দিতে ১০ সেকেন্ডে একবারই লেখা হয় (মাঝের গুনতি পরে একসাথে),
 *   আর এক সার্ভার মিনিটে ৬০ বারের বেশি লেখে না।
 * - কখনো error ছোড়ে না: ত্রুটি লিখতে গিয়ে নতুন সমস্যা যেন আসল কাজ না ভাঙে।
 * - নতুন ধরনের ত্রুটিতে সাপোর্টের ইনবক্সে ইমেইল যায় (error-alerts.server.ts), সব দেখা যায় ডেস্কের
 *   Errors পাতায়। ৩০ দিন না ঘটলে সারিটা মুছে যায়।
 */

export interface ErrorReport {
  source: ErrorSource;
  /** কোথায়: পাতার পথ ("GET /app/offers/:id"), কাজের ধরন বা webhook-এর নাম */
  location: string;
  error: unknown;
  /** যে স্টোরে ঘটেছে (myshopify ঠিকানা), জানা থাকলে */
  shop?: string | null;
  /** ঠিকানা জানা না থাকলে স্টোরের id; ঠিকানাটা ডাটাবেস থেকে নেওয়া হয় */
  shopId?: string | null;
}

interface Entry {
  fingerprint: string;
  source: ErrorSource;
  location: string;
  name: string;
  message: string;
  stack: string | null;
}

const MESSAGE_MAX = 1_000;
const STACK_MAX = 4_000;
const STACK_LINES = 20;
const LOCATION_MAX = 200;
const NAME_MAX = 100;
/** একই ত্রুটি এই সময়ের মধ্যে আবার এলে শুধু গোনা হয়, লেখা হয় পরে একসাথে */
const THROTTLE_MS = 10_000;
/** এক সার্ভার প্রসেস মিনিটে এর বেশি বার খাতায় লেখে না (হাজার রকম ত্রুটির ঝড়েও ডাটাবেস বাঁচে) */
const WRITES_PER_MINUTE = 60;
/** মনে রাখা চাবির সংখ্যা (পুরনোগুলো আগে বাদ) */
const MAX_TRACKED = 1_000;
const KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* ক্রেতার তথ্য আর গোপন চাবি মোছা                                      */
/* ------------------------------------------------------------------ */

const SCRUBBERS: [RegExp, string][] = [
  // JWT (Shopify-র সেশন টোকেন ইত্যাদি)
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[token]"],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, "$1 [secret]"],
  // Shopify-র টোকেন আর অন্য সার্ভিসের চাবি (Stripe-ধরনের sk_/pk_, Resend-এর re_, Svix-এর whsec_, Anthropic-এর sk-ant-)
  [/\b(?:shp(?:at|ca|pa|ss|ua)|sk|pk|rk|re|whsec)_[\w-]{6,}/g, "[secret]"],
  [/\bsk-[\w-]{10,}/g, "[secret]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[secret]"],
  // ঠিকানার ভেতরের গোপন অংশ (?token=..., &signature=...) আর user:password@
  [
    /([?&;](?:access_token|id_token|token|key|api_key|apikey|secret|signature|hmac|code|password|session)=)[^&\s"'<>]+/gi,
    "$1[secret]",
  ],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[secret]@"],
  // ইমেইল (শেষ অংশ অক্ষর হতে হবে, তাই "react-router@7.1.0"-এর মতো প্যাকেজের নাম বাদ)
  [/[\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi, "[email]"],
  // ফোন নম্বর (+ দিয়ে শুরু) আর লম্বা সংখ্যা (ফোন, কার্ড, ক্রেতার id)
  [/\+\d[\d\s().-]{6,}\d/g, "[phone]"],
  [/\b\d{10,}\b/g, "[number]"],
];

export function scrub(text: string): string {
  return SCRUBBERS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

/** চাবি বানানোর জন্য: id, সংখ্যা আর স্টোরের ঠিকানা বাদ, যাতে একই ত্রুটি প্রতিবার আলাদা না হয় */
export function normalize(text: string): string {
  return text
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\bc[a-z0-9]{20,30}\b/g, "<id>")
    .replace(/\b[0-9a-f]{12,}\b/gi, "<id>")
    .replace(/\b[a-z0-9][a-z0-9-]*\.myshopify\.com\b/gi, "<shop>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function parts(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message, stack: error.stack };
  }
  if (typeof error === "string") return { name: "Error", message: error };
  try {
    return { name: "Error", message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { name: "Error", message: String(error) };
  }
}

/**
 * Prisma-র বার্তায় কোডের অংশ আর পুরো query (ক্রেতার নাম-ঠিকানাসহ) থাকতে পারে: শুধু কোন কাজটা ("Invalid
 * `prisma.subscriber.create()` invocation") আর শেষ লাইনের কারণটা রাখি।
 */
function readableMessage(message: string): string {
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1 && /^Invalid `prisma\./.test(lines[0] ?? "")) {
    const call = (lines[0] ?? "").replace(/\s+in$/, "").replace(/:$/, "");
    return `${call}: ${lines.at(-1)}`;
  }
  return lines.join(" ");
}

/** stack-এর শুধু কোডের লাইনগুলো (প্রথম লাইনে বার্তাটাই আবার থাকে, তাই বাদ) */
function frames(stack: string | undefined): string[] {
  if (!stack) return [];
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^at\s/.test(line) || /@\S+:\d+:\d+$/.test(line))
    .slice(0, STACK_LINES);
}

/** নিজেদের কোডের প্রথম লাইন: ফাংশনের নাম আর ফাইলের নাম (লাইন নম্বর বাদ, কোড বদলালে সরে যায় বলে) */
function topFrame(lines: string[]): string {
  const line = lines.find((l) => !l.includes("node_modules") && !l.includes("node:internal"));
  if (!line) return "";
  const frame = line.replace(/^at\s+(?:async\s+)?/, "");
  const open = frame.indexOf(" (");
  const fn = open > 0 ? frame.slice(0, open) : "";
  const where = (open > 0 ? frame.slice(open + 2).replace(/\)$/, "") : frame).replace(
    /(?::\d+){1,2}$/,
    "",
  );
  return `${fn} ${where.split(/[\\/]/).pop() ?? ""}`.trim();
}

function describe(report: ErrorReport): Entry {
  const raw = parts(report.error);
  const name = clip(raw.name, NAME_MAX);
  const message = clip(scrub(readableMessage(raw.message)), MESSAGE_MAX) || "(no message)";
  const lines = frames(raw.stack);
  const stack = lines.length > 0 ? clip(scrub(lines.join("\n")), STACK_MAX) : null;
  const location = clip(scrub(report.location.trim()), LOCATION_MAX) || "unknown";
  // ব্রাউজারের কোডের নাম আর ফাইলের নাম প্রতিটা build-এ বদলায়, তাই অ্যাডমিনের ত্রুটিতে কোডের লাইন চাবিতে ধরা হয় না
  const where = report.source === "admin" ? "" : normalize(topFrame(lines));
  const fingerprint = createHash("sha256")
    .update([report.source, location, name, normalize(message), where].join("\n"))
    .digest("hex")
    .slice(0, 32);
  return { fingerprint, source: report.source, location, name, message, stack };
}

/* ------------------------------------------------------------------ */
/* অনুরোধ থেকে জায়গা আর স্টোর                                         */
/* ------------------------------------------------------------------ */

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function cleanShop(value: string | null | undefined): string | null {
  const shop = value?.trim().toLowerCase();
  return shop && SHOP_DOMAIN.test(shop) ? shop : null;
}

const looksLikeId = (part: string) =>
  /^\d+$/.test(part) ||
  /^c[a-z0-9]{20,30}$/.test(part) ||
  /^[0-9a-f-]{16,}$/i.test(part) ||
  part.length > 40;

/** পাতার পথ থেকে id-গুলো বাদ ("/app/offers/:id"), আর React Router-এর ডেটা অনুরোধের ".data" */
export function pathLocation(pathname: string): string {
  const path = pathname
    .replace(/\.data$/, "")
    .replace(/^\/_root$/, "/")
    .split("/")
    .map((part) => (looksLikeId(part) ? ":id" : part))
    .join("/");
  return path || "/";
}

/** "GET /app/offers/:id" */
export function requestLocation(request: Request): string {
  return `${request.method} ${pathLocation(new URL(request.url).pathname)}`;
}

/**
 * অনুরোধটা কোন স্টোরের: webhook-এর হেডার, ঠিকানার ?shop=, বা অ্যাডমিনের সেশন টোকেনের dest।
 * শুধু খাতায় দেখানোর জন্য; টোকেনের সই এখানে যাচাই হয় না, তাই অনুমতির কাজে এটা চলবে না।
 */
export function requestShop(request: Request): string | null {
  const header = cleanShop(request.headers.get("x-shopify-shop-domain"));
  if (header) return header;
  const param = cleanShop(new URL(request.url).searchParams.get("shop"));
  if (param) return param;
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      dest?: unknown;
    };
    return typeof data.dest === "string" ? cleanShop(new URL(data.dest).hostname) : null;
  } catch {
    return null;
  }
}

async function shopDomain(shop?: string | null, shopId?: string | null): Promise<string | null> {
  const clean = cleanShop(shop);
  if (clean || !shopId) return clean;
  const row = await db.shop.findUnique({ where: { id: shopId }, select: { domain: true } });
  return row?.domain ?? null;
}

/* ------------------------------------------------------------------ */
/* খাতায় লেখা                                                         */
/* ------------------------------------------------------------------ */

interface Pending {
  entry: Entry;
  times: number;
  at: Date;
  shop: string | null;
  shopId: string | null;
}

interface Slot {
  writtenAt: number;
  pending: Pending | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const slots = new Map<string, Slot>();
let budgetMinute = -1;
let budgetUsed = 0;

function takeBudget(now: Date): boolean {
  const minute = Math.floor(now.getTime() / 60_000);
  if (minute !== budgetMinute) {
    budgetMinute = minute;
    budgetUsed = 0;
  }
  if (budgetUsed >= WRITES_PER_MINUTE) return false;
  budgetUsed++;
  if (budgetUsed === WRITES_PER_MINUTE) {
    console.warn("[errors] too many errors this minute; the rest of this minute is not recorded");
  }
  return true;
}

async function write(pending: Pending) {
  const { entry, times, at } = pending;
  const lastShop = await shopDomain(pending.shop, pending.shopId);
  // ঠিক করা বলে চিহ্নিত ত্রুটি আবার ঘটলে আবার খোলে, আর নতুন করে ইমেইল যায়
  await db.appError.updateMany({
    where: { fingerprint: entry.fingerprint, resolvedAt: { not: null } },
    data: { resolvedAt: null, notifiedAt: null },
  });
  await db.appError.upsert({
    where: { fingerprint: entry.fingerprint },
    create: { ...entry, count: times, firstSeenAt: at, lastSeenAt: at, lastShop },
    update: {
      count: { increment: times },
      lastSeenAt: at,
      message: entry.message,
      stack: entry.stack,
      ...(lastShop ? { lastShop } : {}),
    },
  });
}

async function flush(fingerprint: string, now = new Date()) {
  const slot = slots.get(fingerprint);
  if (!slot?.pending) return;
  const pending = slot.pending;
  if (slot.timer) clearTimeout(slot.timer);
  slot.pending = null;
  slot.timer = null;
  slot.writtenAt = now.getTime();
  try {
    if (takeBudget(now)) await write(pending);
  } catch (error) {
    console.error("[errors] could not record an error", error);
  }
}

/**
 * একটা ত্রুটি খাতায় তোলে। কখনো error ছোড়ে না, তাই যেকোনো catch থেকে নিশ্চিন্তে ডাকা যায়
 * (অপেক্ষা না করলেও চলে: `void recordError(...)`)।
 */
export async function recordError(report: ErrorReport, now = new Date()): Promise<void> {
  try {
    const entry = describe(report);
    const pending: Pending = {
      entry,
      times: 1,
      at: now,
      shop: report.shop ?? null,
      shopId: report.shopId ?? null,
    };
    const slot = slots.get(entry.fingerprint);
    const since = slot ? now.getTime() - slot.writtenAt : Infinity;
    if (slot && since < THROTTLE_MS) {
      // একটু আগেই লেখা হয়েছে: এখন শুধু গুনে রাখি, সময় শেষ হলে একসাথে লেখা হয়
      pending.times += slot.pending?.times ?? 0;
      if (!pending.shop && !pending.shopId) {
        pending.shop = slot.pending?.shop ?? null;
        pending.shopId = slot.pending?.shopId ?? null;
      }
      slot.pending = pending;
      if (!slot.timer) {
        slot.timer = setTimeout(() => void flush(entry.fingerprint), THROTTLE_MS - since);
        slot.timer.unref?.();
      }
      return;
    }
    if (slot?.pending) {
      // আগের জমে থাকা গুনতি (সময় পেরিয়েছে, কিন্তু টাইমার এখনো চলেনি) এই লেখার সাথেই যায়
      pending.times += slot.pending.times;
      if (!pending.shop && !pending.shopId) {
        pending.shop = slot.pending.shop;
        pending.shopId = slot.pending.shopId;
      }
    }
    if (slot?.timer) clearTimeout(slot.timer);
    slots.delete(entry.fingerprint);
    slots.set(entry.fingerprint, { writtenAt: now.getTime(), pending: null, timer: null });
    while (slots.size > MAX_TRACKED) {
      const oldest = slots.keys().next().value;
      if (oldest === undefined) break;
      void flush(oldest, now);
      slots.delete(oldest);
    }
    if (takeBudget(now)) await write(pending);
  } catch (error) {
    console.error("[errors] could not record an error", error);
  }
}

/** জমে থাকা গুনতি এখনই লেখা (টেস্ট আর সার্ভার বন্ধের আগে) */
export async function flushErrors(now = new Date()) {
  await Promise.all([...slots.keys()].map((fingerprint) => flush(fingerprint, now)));
}

/** টেস্টের জন্য: মনে রাখা সব কিছু ভুলে যাওয়া */
export function resetErrorLog() {
  for (const slot of slots.values()) if (slot.timer) clearTimeout(slot.timer);
  slots.clear();
  budgetMinute = -1;
  budgetUsed = 0;
}

/* ------------------------------------------------------------------ */
/* ডেস্ক আর রক্ষণাবেক্ষণ                                              */
/* ------------------------------------------------------------------ */

export type ErrorView = "open" | "fixed";

export function deskErrors(view: ErrorView, take = 100) {
  return db.appError.findMany({
    where: view === "open" ? { resolvedAt: null } : { resolvedAt: { not: null } },
    orderBy: view === "open" ? { lastSeenAt: "desc" } : { resolvedAt: "desc" },
    take,
  });
}

export function deskError(id: string) {
  return db.appError.findUnique({ where: { id } });
}

/** খোলা ত্রুটি কতগুলো, আর তার মধ্যে গত ২৪ ঘণ্টায় ঘটেছে কতগুলো */
export async function errorStats(now = new Date()) {
  const [open, lastDay] = await Promise.all([
    db.appError.count({ where: { resolvedAt: null } }),
    db.appError.count({
      where: { resolvedAt: null, lastSeenAt: { gte: new Date(now.getTime() - DAY_MS) } },
    }),
  ]);
  return { open, lastDay };
}

/** ঠিক করা হয়েছে বলে চিহ্নিত বা আবার খোলা; সারি না পেলে false */
export async function setErrorResolved(id: string, resolved: boolean, now = new Date()) {
  const { count } = await db.appError.updateMany({
    where: { id },
    data: { resolvedAt: resolved ? now : null },
  });
  return count > 0;
}

/** ৩০ দিন না ঘটা ত্রুটি মোছা */
export async function pruneErrors(now = new Date()) {
  const { count } = await db.appError.deleteMany({
    where: { lastSeenAt: { lt: new Date(now.getTime() - KEEP_DAYS * DAY_MS) } },
  });
  return count;
}

/** স্টোরের সব তথ্য মোছার সময় (shop/redact): খাতায় তার ঠিকানাও না থাকুক */
export async function forgetShopErrors(domain: string) {
  await db.appError.updateMany({ where: { lastShop: domain }, data: { lastShop: null } });
}
