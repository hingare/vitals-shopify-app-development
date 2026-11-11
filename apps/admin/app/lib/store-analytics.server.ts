import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import db from "../db.server";
import { utcDay } from "./analytics.server";

/* ------------------------------------------------------------------ */
/* Web Pixel থেকে আসা ইভেন্ট যাচাই                                     */
/* ------------------------------------------------------------------ */

export const PIXEL_KINDS = ["page", "product", "cart", "checkout", "order"] as const;
export type PixelKind = (typeof PIXEL_KINDS)[number];
const MAX_EVENTS = 30;

export interface PixelEvent {
  t: PixelKind;
  p?: string;
  r?: string;
  q?: string;
  a?: number;
}

export interface PixelBatch {
  key: string;
  clientId: string;
  host: string;
  userAgent: string;
  events: PixelEvent[];
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** পিক্সেলের পাঠানো JSON যাচাই করে; অচেনা বা ভুল ইভেন্ট বাদ দেয়। */
export function parsePixelBatch(body: unknown): PixelBatch | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const key = str(b.k, 64);
  const clientId = str(b.v, 128);
  if (!key || !clientId || !Array.isArray(b.e)) return null;
  const events: PixelEvent[] = [];
  for (const raw of b.e.slice(0, MAX_EVENTS)) {
    const e = (raw ?? {}) as Record<string, unknown>;
    if (typeof e.t !== "string" || !(PIXEL_KINDS as readonly string[]).includes(e.t)) continue;
    const amount = typeof e.a === "number" && Number.isFinite(e.a) && e.a >= 0 ? e.a : undefined;
    events.push({
      t: e.t as PixelKind,
      p: str(e.p, 200),
      r: str(e.r, 300),
      q: str(e.q, 300),
      a: amount === undefined ? undefined : Math.min(amount, 10_000_000),
    });
  }
  if (events.length === 0) return null;
  return {
    key,
    clientId,
    host: str(b.h, 255) ?? "",
    userAgent: str(b.ua, 500) ?? "",
    events,
  };
}

/* ------------------------------------------------------------------ */
/* সোর্স, ডিভাইস ও পেজ শ্রেণীবিভাগ                                      */
/* ------------------------------------------------------------------ */

export const SOURCES = ["direct", "search", "social", "ai", "email", "paid", "referral"] as const;
export type Source = (typeof SOURCES)[number];
export const DEVICES = ["mobile", "tablet", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|naver)\./;
const SOCIAL =
  /(^|\.)(facebook|fb|instagram|tiktok|twitter|x|t|pinterest|youtube|linkedin|reddit|snapchat|threads|whatsapp|telegram|messenger)\.(com|co|me|net|org)$|^l\.facebook\.com$|^lm\.facebook\.com$/;
const AI =
  /(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|gemini\.google\.com|claude\.ai|copilot\.microsoft\.com|you\.com|grok\.com|meta\.ai|deepseek\.com)$/;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** referrer আর UTM দেখে ভিজিটর কোথা থেকে এলো তা ঠিক করে */
export function classifySource(referrer = "", search = "", storeHost = ""): Source {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const medium = (params.get("utm_medium") ?? "").toLowerCase();
  const utmSource = (params.get("utm_source") ?? "").toLowerCase();
  if (params.has("gclid") || params.has("msclkid")) return "paid";
  if (/^(cpc|ppc|paid|paidsocial|paid_social|display|cpm)/.test(medium)) return "paid";
  if (medium === "email" || medium === "newsletter" || medium === "sms") return "email";
  if (/chatgpt|openai|perplexity|gemini|claude|copilot/.test(utmSource)) return "ai";

  const host = hostOf(referrer);
  const own = storeHost.toLowerCase().replace(/^www\./, "");
  if (!host || (own && host === own) || host.endsWith(".myshopify.com")) {
    if (medium === "social" || /facebook|instagram|tiktok/.test(utmSource)) return "social";
    return "direct";
  }
  if (AI.test(host)) return "ai";
  if (SEARCH.test(host)) return "search";
  if (SOCIAL.test(host)) return "social";
  if (/mail\./.test(host) || host === "outlook.live.com") return "email";
  return "referral";
}

export function classifyDevice(userAgent = ""): Device {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/.test(ua)) return "mobile";
  return "desktop";
}

/** একই ধরনের পেজ এক সারিতে আসুক: /collections/x/products/y → /products/y, শেষের / বাদ */
export function normalizePath(path = "/"): string {
  let p = path.split("?")[0].split("#")[0] || "/";
  p = p.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/)/i, ""); // /en-us/products → /products
  p = p.replace(/^\/collections\/[^/]+(\/products\/)/, "$1");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p.toLowerCase().slice(0, 200) || "/";
}

export function hashVisitor(shopId: string, clientId: string): string {
  return createHash("sha256").update(`${shopId}:${clientId}`).digest("hex").slice(0, 32);
}

/* ------------------------------------------------------------------ */
/* ডাটাবেসে লেখা                                                       */
/* ------------------------------------------------------------------ */

export interface Counts {
  pageViews: number;
  productViews: number;
  addToCarts: number;
  checkouts: number;
  orders: number;
  revenue: number;
  pages: Map<string, number>;
}

export function countEvents(events: PixelEvent[]): Counts {
  const c: Counts = {
    pageViews: 0,
    productViews: 0,
    addToCarts: 0,
    checkouts: 0,
    orders: 0,
    revenue: 0,
    pages: new Map(),
  };
  for (const e of events) {
    if (e.t === "page") {
      c.pageViews++;
      const path = normalizePath(e.p);
      c.pages.set(path, (c.pages.get(path) ?? 0) + 1);
    }
    if (e.t === "product") c.productViews++;
    if (e.t === "cart") c.addToCarts++;
    if (e.t === "checkout") c.checkouts++;
    if (e.t === "order") {
      c.orders++;
      c.revenue += e.a ?? 0;
    }
  }
  c.revenue = Math.round(c.revenue * 100) / 100;
  return c;
}

export async function recordPixelBatch(shopId: string, batch: PixelBatch, now = new Date()) {
  const date = utcDay(now);
  const visitor = hashVisitor(shopId, batch.clientId);
  const { count: isNew } = await db.visitorDay.createMany({
    data: [{ shopId, date, visitor }],
    skipDuplicates: true,
  });
  const c = countEvents(batch.events);
  const revenue = new Prisma.Decimal(c.revenue.toFixed(2));

  const writes: Promise<unknown>[] = [
    db.dailyStoreStat.upsert({
      where: { shopId_date: { shopId, date } },
      create: {
        shopId,
        date,
        visitors: isNew,
        pageViews: c.pageViews,
        productViews: c.productViews,
        addToCarts: c.addToCarts,
        checkouts: c.checkouts,
        orders: c.orders,
        revenue,
      },
      update: {
        visitors: { increment: isNew },
        pageViews: { increment: c.pageViews },
        productViews: { increment: c.productViews },
        addToCarts: { increment: c.addToCarts },
        checkouts: { increment: c.checkouts },
        orders: { increment: c.orders },
        revenue: { increment: revenue },
      },
    }),
    ...[...c.pages].map(([path, views]) =>
      db.dailyPageStat.upsert({
        where: { shopId_date_path: { shopId, date, path } },
        create: { shopId, date, path, views },
        update: { views: { increment: views } },
      }),
    ),
  ];

  if (isNew) {
    const firstPage = batch.events.find((e) => e.t === "page");
    const source = classifySource(firstPage?.r, firstPage?.q, batch.host);
    const device = classifyDevice(batch.userAgent);
    writes.push(
      db.dailyTrafficStat.upsert({
        where: { shopId_date_source_device: { shopId, date, source, device } },
        create: { shopId, date, source, device, visitors: 1 },
        update: { visitors: { increment: 1 } },
      }),
    );
  }
  await Promise.all(writes);
}

/** পুরনো ভিজিটর-দিনের সারি মুছে ফেলে (শুধু আজকের হিসাবের জন্য দরকার) */
export async function pruneVisitorDays(now = new Date()) {
  const cutoff = utcDay(new Date(now.getTime() - 2 * 86_400_000));
  return db.visitorDay.deleteMany({ where: { date: { lt: cutoff } } });
}

/* ------------------------------------------------------------------ */
/* রিপোর্ট                                                             */
/* ------------------------------------------------------------------ */

export async function getStoreReport(shopId: string, days: number) {
  const since = utcDay(new Date(Date.now() - (days - 1) * 86_400_000));
  const where = { shopId, date: { gte: since } };
  const [daily, traffic, pages] = await Promise.all([
    db.dailyStoreStat.findMany({ where, orderBy: { date: "asc" } }),
    db.dailyTrafficStat.groupBy({
      by: ["source", "device"],
      where,
      _sum: { visitors: true },
    }),
    db.dailyPageStat.groupBy({
      by: ["path"],
      where,
      _sum: { views: true },
      orderBy: { _sum: { views: "desc" } },
      take: 10,
    }),
  ]);

  const totals = daily.reduce(
    (t, d) => ({
      visitors: t.visitors + d.visitors,
      pageViews: t.pageViews + d.pageViews,
      productViews: t.productViews + d.productViews,
      addToCarts: t.addToCarts + d.addToCarts,
      checkouts: t.checkouts + d.checkouts,
      orders: t.orders + d.orders,
      revenue: t.revenue + Number(d.revenue),
    }),
    {
      visitors: 0,
      pageViews: 0,
      productViews: 0,
      addToCarts: 0,
      checkouts: 0,
      orders: 0,
      revenue: 0,
    },
  );

  const bySource = new Map<string, number>();
  const byDevice = new Map<string, number>();
  for (const row of traffic) {
    const v = row._sum.visitors ?? 0;
    bySource.set(row.source, (bySource.get(row.source) ?? 0) + v);
    byDevice.set(row.device, (byDevice.get(row.device) ?? 0) + v);
  }
  const sortDesc = (m: Map<string, number>) =>
    [...m].map(([name, visitors]) => ({ name, visitors })).sort((a, b) => b.visitors - a.visitors);

  return {
    totals,
    daily: daily.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      visitors: d.visitors,
      orders: d.orders,
    })),
    sources: sortDesc(bySource),
    devices: sortDesc(byDevice),
    pages: pages.map((p) => ({ path: p.path, views: p._sum.views ?? 0 })),
  };
}

export { rate } from "./rate";
