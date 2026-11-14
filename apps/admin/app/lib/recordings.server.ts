import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import db from "../db.server";
import { cleanPath } from "./chat.server";
import { deleteObjects, getObject, objectStoreKind, putObject } from "./object-store.server";
import { enqueueJob, registerJob } from "./queue.server";
import { adjustUsage, readUsage, reserveUsage, type UsageShop } from "./usage.server";

/**
 * Visitor Recordings-এর সার্ভার অংশ।
 * - ব্রাউজার কয়েক সেকেন্ড পরপর ছোট অংশ (gzip করা rrweb ঘটনা) পাঠায়; প্রতিটা যাচাই করে ডাটাবেসে জমা হয়।
 * - কয়েক মিনিট নতুন অংশ না এলে জমা অংশগুলো এক ফাইলে স্টোরেজে (R2) যায়: একটা রেকর্ডিং মানে সাধারণত
 *   একটাই লেখা, তাই স্টোরেজের খরচ রেকর্ড-প্রতি নির্দিষ্ট সীমার নিচে থাকে (plans.ts: RECORDING_COST_MICROS)।
 * - নতুন রেকর্ডিং শুরুর সময় মাসিক সীমা থেকে ১টা ধরা হয়; সীমা ফুরালে ব্রাউজারকে থামতে বলা হয়।
 * - প্রতিটা রেকর্ডিংয়ের আকার, দৈর্ঘ্য আর ফাইলের সংখ্যা বাঁধা, আর ৩০ দিন পরে নিজে থেকেই মুছে যায়।
 */
export const MAX_CHUNK_BYTES = 512 * 1024;
export const MAX_CHUNK_RAW = 8 * 1024 * 1024;
export const MAX_EVENTS = 20_000;
export const MAX_CHUNKS = 300;
export const MAX_RECORDING_BYTES = 4 * 1024 * 1024;
export const MAX_RECORDING_RAW = 40 * 1024 * 1024;
export const MAX_DURATION_MS = 30 * 60_000;
export const MAX_PARTS = 4;
/** এতক্ষণ নতুন অংশ না এলে জমা অংশগুলো স্টোরেজে যায় */
export const IDLE_MS = 5 * 60_000;
export const RETENTION_DAYS = 30;
const MAX_PAGES = 50;
const KEY = /^[A-Za-z0-9_-]{32,64}$/;
/** rrweb-এর ঘটনার ধরন: 0-8 (DomContentLoaded … Annotation) */
const MAX_EVENT_TYPE = 8;

export type ChunkError = "invalid" | "limit" | "cap" | "full" | "storage";

export function hashRecordingKey(raw: unknown): string | null {
  return typeof raw === "string" && KEY.test(raw)
    ? createHash("sha256").update(raw).digest("hex")
    : null;
}

export const partKey = (shopId: string, recordingId: string, part: number) =>
  `recordings/${shopId}/${recordingId}/${part}.json.gz`;

export interface ChunkStats {
  events: number;
  first: number;
  last: number;
  /** Meta ঘটনা: প্রতিটা নতুন পাতা */
  pageViews: number;
  paths: string[];
  clicks: number;
  width: number | null;
  height: number | null;
}

const isInt = (value: unknown): value is number => Number.isInteger(value);

function pathFromHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  try {
    return cleanPath(new URL(href).pathname);
  } catch {
    return null;
  }
}

/** ঘটনাগুলো rrweb-এর আকারের কিনা দেখে আর তালিকার জন্য ছোট হিসাব বের করে; ভুল থাকলে null */
export function inspectEvents(value: unknown): ChunkStats | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVENTS) return null;
  const stats: ChunkStats = {
    events: value.length,
    first: Infinity,
    last: -Infinity,
    pageViews: 0,
    paths: [],
    clicks: 0,
    width: null,
    height: null,
  };
  for (const event of value) {
    if (!event || typeof event !== "object" || Array.isArray(event)) return null;
    const { type, timestamp, data } = event as {
      type?: unknown;
      timestamp?: unknown;
      data?: unknown;
    };
    if (!isInt(type) || type < 0 || type > MAX_EVENT_TYPE) return null;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return null;
    stats.first = Math.min(stats.first, timestamp);
    stats.last = Math.max(stats.last, timestamp);
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    if (type === 4) {
      stats.pageViews++;
      const path = pathFromHref(d.href);
      if (path) stats.paths.push(path);
      if (stats.width === null && isInt(d.width) && isInt(d.height)) {
        stats.width = Math.min(Math.max(d.width, 0), 10_000);
        stats.height = Math.min(Math.max(d.height, 0), 10_000);
      }
    }
    // IncrementalSnapshot → MouseInteraction → Click
    if (type === 3 && d.source === 2 && d.type === 2) stats.clicks++;
  }
  return stats;
}

/** কয়েকটা JSON তালিকা ("[…]") খুলে না দেখেই এক তালিকায় জোড়া (প্রতিটা আগেই যাচাই করা) */
export function joinArrays(texts: string[]): string {
  const inner = texts.map((text) => text.trim().slice(1, -1).trim()).filter(Boolean);
  return `[${inner.join(",")}]`;
}

function mergePaths(current: string[], next: string[]): string[] {
  const out = [...current];
  for (const path of next) {
    if (out.length >= MAX_PAGES) break;
    if (out[out.length - 1] !== path) out.push(path);
  }
  return out;
}

export interface ChunkInput {
  key: unknown;
  seq: unknown;
  /** gzip করা JSON, base64-এ (সাধারণ পথ) */
  data?: unknown;
  /** পেজ ছাড়ার সময় sendBeacon-এ gzip ছাড়া আসা ঘটনা */
  events?: unknown;
  page?: unknown;
  device?: unknown;
  customerId?: string | null;
}

export type IngestResult = { ok: true; created: boolean } | { ok: false; error: ChunkError };

/** ব্রাউজারের পাঠানো অংশ খুলে যাচাই; ভুল হলে null (zip bomb আটকাতে খোলা আকারও বাঁধা) */
function decodeChunk(input: ChunkInput): { gz: Buffer; text: string; events: unknown } | null {
  try {
    if (typeof input.data === "string") {
      if (input.data.length > Math.ceil(MAX_CHUNK_BYTES / 3) * 4 + 4) return null;
      const gz = Buffer.from(input.data, "base64");
      if (gz.length < 18 || gz.length > MAX_CHUNK_BYTES || gz[0] !== 0x1f || gz[1] !== 0x8b) {
        return null;
      }
      const text = gunzipSync(gz, { maxOutputLength: MAX_CHUNK_RAW }).toString("utf8");
      return { gz, text, events: JSON.parse(text) };
    }
    if (Array.isArray(input.events)) {
      const text = JSON.stringify(input.events);
      if (Buffer.byteLength(text) > MAX_CHUNK_RAW) return null;
      return { gz: gzipSync(text), text, events: input.events };
    }
  } catch {
    // ভাঙা gzip, খুব বড়, বা JSON নয়
  }
  return null;
}

/** নতুন রেকর্ডিং শুরু করা যাবে কিনা (স্টোরেজ আছে আর এই মাসের সীমা ফুরায়নি) */
export async function canRecord(shop: UsageShop, now = new Date()) {
  if (objectStoreKind() === "none") return false;
  return (await readUsage(shop, "recordings", now)).left > 0;
}

export async function ingestChunk(
  shop: UsageShop,
  input: ChunkInput,
  options: { mayCreate?: () => boolean } = {},
  now = new Date(),
): Promise<IngestResult> {
  if (objectStoreKind() === "none") return { ok: false, error: "storage" };
  const keyHash = hashRecordingKey(input.key);
  const seq = input.seq;
  if (!keyHash || !isInt(seq) || seq < 0 || seq >= MAX_CHUNKS * 2) {
    return { ok: false, error: "invalid" };
  }
  const chunk = decodeChunk(input);
  const stats = chunk && inspectEvents(chunk.events);
  if (!chunk || !stats) return { ok: false, error: "invalid" };
  const rawBytes = Buffer.byteLength(chunk.text);

  const where = { shopId_keyHash: { shopId: shop.id, keyHash } };
  let recording = await db.recording.findUnique({ where });
  let created = false;
  if (!recording) {
    if (options.mayCreate && !options.mayCreate()) return { ok: false, error: "limit" };
    const reserved = await reserveUsage(shop, "recordings", 1, now);
    if (!reserved.ok) return { ok: false, error: "cap" };
    try {
      recording = await db.recording.create({
        data: {
          shopId: shop.id,
          keyHash,
          customerId:
            input.customerId && /^\d{1,20}$/.test(input.customerId) ? input.customerId : null,
          device: input.device === "mobile" ? "mobile" : "desktop",
          entryPath: stats.paths[0] ?? cleanPath(input.page) ?? "/",
          lastChunkAt: now,
          createdAt: now,
        },
      });
      created = true;
    } catch (error) {
      // একই রেকর্ডিংয়ের দুটো অংশ একসাথে এসে দুজনেই নতুন বানাতে গেলে: একটা থাকে, ধরা সংখ্যা ফেরত
      await adjustUsage(shop.id, "recordings", reserved.month, -1);
      recording = await db.recording.findUnique({ where });
      if (!recording) throw error;
    }
  }
  if (recording.stopped) return { ok: false, error: "full" };

  const first = Math.min(recording.firstEventAt?.getTime() ?? Infinity, stats.first);
  const last = Math.max(recording.lastEventAt?.getTime() ?? -Infinity, stats.last);
  const tooBig =
    recording.chunks >= MAX_CHUNKS ||
    recording.parts >= MAX_PARTS ||
    recording.bytes + chunk.gz.length > MAX_RECORDING_BYTES ||
    recording.rawBytes + rawBytes > MAX_RECORDING_RAW ||
    last - first > MAX_DURATION_MS;
  if (tooBig) {
    await db.recording.update({ where: { id: recording.id }, data: { stopped: "full" } });
    return { ok: false, error: "full" };
  }

  try {
    await db.recordingChunk.create({
      data: { recordingId: recording.id, seq, data: new Uint8Array(chunk.gz), createdAt: now },
    });
  } catch {
    // একই অংশ আবার এলে (নেটওয়ার্কের কারণে) আগেরটাই থাকে
    return { ok: true, created };
  }
  await db.recording.update({
    where: { id: recording.id },
    data: {
      chunks: { increment: 1 },
      bytes: { increment: chunk.gz.length },
      rawBytes: { increment: rawBytes },
      clicks: { increment: stats.clicks },
      pageViews: { increment: stats.pageViews },
      pages: mergePaths(recording.pages, stats.paths),
      firstEventAt: new Date(first),
      lastEventAt: new Date(last),
      durationMs: Math.max(0, last - first),
      lastChunkAt: now,
      ...(recording.width === null && stats.width !== null
        ? { width: stats.width, height: stats.height }
        : {}),
    },
  });
  await enqueueJob(
    shop.id,
    `rec-finalize:${recording.id}`,
    { id: recording.id },
    { runAt: new Date(now.getTime() + IDLE_MS), unique: true },
  );
  return { ok: true, created };
}

/**
 * জমা অংশগুলো এক ফাইলে স্টোরেজে রাখে। নতুন অংশ আসতে থাকলে পরে আবার দেখে।
 * আগে ফাইল লেখা, তারপর একসাথে (transaction) অংশ মোছা আর হিসাব বাড়ানো: মাঝপথে থামলে আবার চালালে
 * একই নামের ফাইলই আবার লেখা হয়, কিছু হারায় না।
 */
export async function finalizeRecording(
  id: string,
  now = new Date(),
): Promise<{ again?: boolean; delayMs?: number }> {
  const recording = await db.recording.findUnique({ where: { id } });
  if (!recording) return {};
  const quietFor = now.getTime() - recording.lastChunkAt.getTime();
  if (quietFor < IDLE_MS) return { again: true, delayMs: IDLE_MS - quietFor };
  const chunks = await db.recordingChunk.findMany({
    where: { recordingId: id },
    orderBy: { seq: "asc" },
  });
  if (chunks.length === 0) return {};
  const body = gzipSync(joinArrays(chunks.map((c) => gunzipSync(c.data).toString("utf8"))));
  await putObject(partKey(recording.shopId, id, recording.parts), body, "application/gzip");
  await db.$transaction([
    db.recordingChunk.deleteMany({ where: { id: { in: chunks.map((c) => c.id) } } }),
    db.recording.update({
      where: { id },
      data: { parts: { increment: 1 }, storedBytes: { increment: body.length } },
    }),
  ]);
  const left = await db.recordingChunk.count({ where: { recordingId: id } });
  return left > 0 ? { again: true, delayMs: IDLE_MS } : {};
}

registerJob("rec-finalize", async (job) => {
  const id = typeof job.payload.id === "string" ? job.payload.id : job.kind.split(":")[1];
  return id ? finalizeRecording(id) : undefined;
});

/** রিপ্লের জন্য পুরো রেকর্ডিং: স্টোরেজের ফাইল আর এখনো জমা অংশ, এক JSON তালিকায়, gzip করা */
export async function recordingEvents(shopId: string, id: string): Promise<Buffer | null> {
  const recording = await db.recording.findFirst({ where: { id, shopId } });
  if (!recording) return null;
  const texts: string[] = [];
  for (let part = 0; part < recording.parts; part++) {
    const body = await getObject(partKey(shopId, id, part));
    if (body) texts.push(gunzipSync(body).toString("utf8"));
  }
  const staged = await db.recordingChunk.findMany({
    where: { recordingId: id },
    orderBy: { seq: "asc" },
  });
  for (const chunk of staged) texts.push(gunzipSync(chunk.data).toString("utf8"));
  return gzipSync(joinArrays(texts));
}

export type DeviceFilter = "all" | "desktop" | "mobile";

export async function listRecordings(
  shopId: string,
  filters: { device?: DeviceFilter; minSeconds?: number; before?: Date | null } = {},
  take = 50,
) {
  const rows = await db.recording.findMany({
    where: {
      shopId,
      chunks: { gt: 0 },
      ...(filters.device && filters.device !== "all" ? { device: filters.device } : {}),
      ...(filters.minSeconds ? { durationMs: { gte: filters.minSeconds * 1000 } } : {}),
      ...(filters.before ? { createdAt: { lt: filters.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: take + 1,
  });
  return { rows: rows.slice(0, take), more: rows.length > take };
}

export async function getRecording(shopId: string, id: string) {
  return db.recording.findFirst({ where: { id, shopId } });
}

type Removable = { id: string; shopId: string; parts: number };

async function removeRecordings(rows: Removable[]) {
  if (rows.length === 0) return 0;
  await deleteObjects(
    rows.flatMap((row) =>
      Array.from({ length: row.parts }, (_, part) => partKey(row.shopId, row.id, part)),
    ),
  );
  const ids = rows.map((row) => row.id);
  await db.recordingChunk.deleteMany({ where: { recordingId: { in: ids } } });
  const { count } = await db.recording.deleteMany({ where: { id: { in: ids } } });
  await db.job.deleteMany({
    where: { kind: { in: ids.map((id) => `rec-finalize:${id}`) }, status: "pending" },
  });
  return count;
}

export async function deleteRecording(shopId: string, id: string) {
  const row = await db.recording.findFirst({ where: { id, shopId } });
  return row ? (await removeRecordings([row])) > 0 : false;
}

/** ক্রেতার তথ্য মোছার অনুরোধে (customers/redact): সেই লগইন করা ক্রেতার সব রেকর্ডিং */
export async function deleteCustomerRecordings(shopId: string, customerId: string) {
  const rows = await db.recording.findMany({ where: { shopId, customerId } });
  return removeRecordings(rows);
}

/** স্টোরের সব রেকর্ডিং (shop/redact-এ, স্টোরের সারি মোছার আগে: স্টোরেজের ফাইল cascade-এ মোছে না) */
export async function deleteShopRecordings(shopId: string) {
  let total = 0;
  for (;;) {
    const rows = await db.recording.findMany({ where: { shopId }, take: 200 });
    if (rows.length === 0) return total;
    total += await removeRecordings(rows);
  }
}

/** ক্রেতার তথ্য চাইলে (customers/data_request): রেকর্ডিংয়ের তালিকা */
export async function customerRecordings(shopId: string, customerId: string) {
  const rows = await db.recording.findMany({
    where: { shopId, customerId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    recordedAt: row.createdAt,
    seconds: Math.round(row.durationMs / 1000),
    device: row.device,
    pages: row.pages,
  }));
}

/** ৩০ দিনের পুরনো রেকর্ডিং মোছে (প্রতি ঘণ্টায় কিছু করে, তাই একবারে ভারী কাজ হয় না) */
export async function pruneRecordings(now = new Date(), batch = 500) {
  const rows = await db.recording.findMany({
    where: { createdAt: { lt: new Date(now.getTime() - RETENTION_DAYS * 86_400_000) } },
    orderBy: { createdAt: "asc" },
    take: batch,
  });
  return removeRecordings(rows);
}
