import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import db from "../../../db.server";
import { deleteObjects, objectStoreKind, putObject } from "../../object-store.server";
import { AiError } from "../errors";
import { MEDIA_RETENTION_DAYS, type MediaFile, type MediaMime } from "./output";
import { flattenPng } from "./png";

/**
 * AI-র বানানো ছবি আর ভিডিও আমাদের নিজের স্টোরেজে (R2, ডেভেলপমেন্টে ডিস্ক):
 *   ai-media/<shopId>/<generationId>/<ক্রম>.<ধরন>
 * fal-এর ঠিকানা থেকে নামানোর সময় শুধু fal-এর নিজের ডোমেইন, আকারের সীমা আর ফাইলের ভেতরের ধরন
 * (প্রথম কয়েকটা বাইট) মিলিয়ে নেওয়া হয়। অ্যাডমিনে দেখানো হয় সই করা, সময়সীমা দেওয়া ঠিকানায় (/media)।
 * কাজ ফেলে দিলে, ৩০ দিন পেরোলে বা দোকানের তথ্য মোছার অনুরোধে ফাইলগুলো মুছে যায়।
 */
export const MEDIA_PREFIX = "ai-media/";

export const mediaPrefix = (shopId: string, generationId: string) =>
  `${MEDIA_PREFIX}${shopId}/${generationId}/`;

/** ছবি ও ভিডিও রাখার জায়গা আছে কিনা (প্রোডাকশনে R2 লাগে) */
export const mediaStorageReady = () => objectStoreKind() !== "none";

const LIMITS = { image: 30 * 1024 * 1024, video: 150 * 1024 * 1024 } as const;
const TIMEOUTS = { image: 60_000, video: 180_000 } as const;

type FetchFn = typeof fetch;
let fetchImpl: FetchFn | null = null;

/** টেস্টে নকল fetch বসাতে (null দিলে আবার আসলটা) */
export function setMediaFetchForTests(fn: FetchFn | null) {
  fetchImpl = fn;
}

/** fal-এর ফলের ফাইল শুধু তাদের নিজের ঠিকানা থেকে নামানো হয় */
export function allowedMediaUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (
    host === "fal.media" ||
    host.endsWith(".fal.media") ||
    host.endsWith(".fal.run") ||
    host.endsWith(".fal.ai")
  ) {
    return url;
  }
  if (host === "storage.googleapis.com" && url.pathname.startsWith("/falserverless/")) return url;
  return null;
}

const EXT: Record<MediaMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

/** ফাইলের প্রথম বাইটগুলো দেখে আসল ধরন (নামের বা fal-এর বলা ধরনের উপর ভরসা না করে) */
export function sniffMedia(buf: Buffer): MediaMime | null {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 12 &&
    buf.toString("latin1", 0, 4) === "RIFF" &&
    buf.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 12 && buf.toString("latin1", 4, 8) === "ftyp") return "video/mp4";
  return null;
}

/** ছবির মাপ (PNG, JPEG, WebP-র header থেকে); বোঝা না গেলে null */
export function imageSize(buf: Buffer, mime: MediaMime): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && buf.length >= 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1] as number;
        if (marker === 0xff) {
          i++;
          continue;
        }
        // SOF0 থেকে SOF15 (DHT, JPG আর DAC বাদে): এখানেই মাপ থাকে
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
    if (mime === "image/webp" && buf.length >= 30) {
      const chunk = buf.toString("latin1", 12, 16);
      if (chunk === "VP8 ") {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === "VP8L") {
        const b0 = buf[21] as number;
        const b1 = buf[22] as number;
        const b2 = buf[23] as number;
        const b3 = buf[24] as number;
        return {
          width: 1 + (((b1 & 0x3f) << 8) | b0),
          height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
        };
      }
      if (chunk === "VP8X") {
        return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** সীমার বেশি হলে মাঝপথেই থামিয়ে দেয় (পুরো ফাইল মেমোরিতে না এনে) */
async function readLimited(res: Response, limit: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > limit) throw new AiError("failed", `Media file too large: ${declared}`);
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new AiError("failed", "Media file too large");
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/**
 * fal-এর ফলের ফাইল নামিয়ে আমাদের স্টোরেজে রাখে, আর কাজের সাথে ফাইলের নাম লিখে রাখে (পরে মোছার জন্য)।
 * `flatten: "white"` দিলে স্বচ্ছ PNG সাদা পটভূমিতে বসানো হয় (না পারলে স্বচ্ছই থাকে)।
 */
export async function storeMediaFiles(
  shopId: string,
  generationId: string,
  urls: unknown[],
  kind: "image" | "video",
  options: { flatten?: "white" } = {},
): Promise<MediaFile[]> {
  if (urls.length === 0 || urls.length > 4) {
    throw new AiError("failed", `Unexpected number of results: ${urls.length}`);
  }
  const files: MediaFile[] = [];
  try {
    await downloadAll(shopId, generationId, urls, kind, options, files);
  } catch (error) {
    // অর্ধেক নামানো ফাইল পড়ে না থাকে (আবার চেষ্টায় নতুন করে নামানো হবে)
    await deleteObjects(files.map((file) => file.key)).catch(() => undefined);
    throw error;
  }
  await db.aiGeneration.update({
    where: { id: generationId },
    data: { mediaKeys: files.map((file) => file.key) },
  });
  return files;
}

async function downloadAll(
  shopId: string,
  generationId: string,
  urls: unknown[],
  kind: "image" | "video",
  options: { flatten?: "white" },
  files: MediaFile[],
) {
  for (const [index, raw] of urls.entries()) {
    const url = allowedMediaUrl(raw);
    if (!url) throw new AiError("failed", `Result URL not allowed: ${String(raw).slice(0, 200)}`);
    let res: Response;
    try {
      res = await (fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(TIMEOUTS[kind]) });
    } catch (error) {
      throw new AiError("busy", error instanceof Error ? error.message : String(error));
    }
    if (!res.ok) {
      throw new AiError(res.status >= 500 ? "busy" : "failed", `Download ${res.status}`);
    }
    let body = await readLimited(res, LIMITS[kind]);
    const mime = sniffMedia(body);
    if (mime === "image/png" && options.flatten === "white") body = flattenPng(body) ?? body;
    if (!mime || (kind === "video") !== (mime === "video/mp4")) {
      throw new AiError("failed", `Unexpected media type from ${url.hostname}`);
    }
    const key = `${mediaPrefix(shopId, generationId)}${index}.${EXT[mime]}`;
    await putObject(key, body, mime);
    const size = kind === "image" ? imageSize(body, mime) : null;
    files.push({
      key,
      type: kind,
      mime,
      bytes: body.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
    });
  }
}

const MIME_BY_EXT: Record<string, MediaMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
};

export const mimeForKey = (key: string): MediaMime | null =>
  MIME_BY_EXT[key.split(".").pop() ?? ""] ?? null;

export const extForMime = (mime: MediaMime) => EXT[mime];

// ---------- সই করা ঠিকানা ----------

/** প্রিভিউর ঠিকানা কতক্ষণ চলে */
export const MEDIA_URL_TTL_SECONDS = 6 * 60 * 60;

function signingKey(): Buffer {
  const secret = process.env.SHOPIFY_API_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw new Error("SHOPIFY_API_SECRET is not set");
    return createHash("sha256").update("dev-only-media-url-key").digest();
  }
  // অ্যাপের secret সরাসরি নয়, শুধু এই কাজের জন্য তা থেকে বানানো চাবি
  return createHmac("sha256", secret).update("ai-media-url").digest();
}

const signature = (key: string, expires: number, download: string) =>
  createHmac("sha256", signingKey()).update(`${key}\n${expires}\n${download}`).digest("base64url");

/** নামানোর ফাইলের নাম: শুধু সাধারণ অক্ষর */
export const safeFilename = (name: string) =>
  name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "file";

/** স্টোরেজের ফাইল দেখার ঠিকানা; `download` দিলে ব্রাউজার সেই নামে নামায় */
export function signMediaPath(
  key: string,
  options: { download?: string; ttlSeconds?: number } = {},
  now = Date.now(),
): string {
  const expires = Math.floor(now / 1000) + (options.ttlSeconds ?? MEDIA_URL_TTL_SECONDS);
  const download = options.download ? safeFilename(options.download) : "";
  const params = new URLSearchParams({ k: key, e: String(expires) });
  if (download) params.set("d", download);
  params.set("s", signature(key, expires, download));
  return `/media?${params.toString()}`;
}

export function verifyMediaQuery(
  params: URLSearchParams,
  now = Date.now(),
): { key: string; download: string } | null {
  const key = params.get("k") ?? "";
  const expires = Number(params.get("e"));
  const download = params.get("d") ?? "";
  const given = Buffer.from(params.get("s") ?? "");
  if (!key.startsWith(MEDIA_PREFIX) || !Number.isInteger(expires)) return null;
  if (expires * 1000 < now) return null;
  if (download && download !== safeFilename(download)) return null;
  const expected = Buffer.from(signature(key, expires, download));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { key, download };
}

/** ফাইলের উত্তর, ভিডিওর জন্য Range সহ (Safari Range ছাড়া ভিডিও চালায় না) */
export function mediaResponse(
  body: Buffer,
  mime: string,
  range: string | null,
  download = "",
): Response {
  const headers = new Headers({
    "content-type": mime,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
  });
  if (download) headers.set("content-disposition", `attachment; filename="${download}"`);
  const total = body.length;
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (range && (!match || (match[1] === "" && match[2] === ""))) {
    headers.set("content-range", `bytes */${total}`);
    return new Response(null, { status: 416, headers });
  }
  if (match) {
    let start: number;
    let end: number;
    if (match[1] === "") {
      // শেষের N বাইট
      start = Math.max(0, total - Number(match[2]));
      end = total - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === "" ? total - 1 : Math.min(Number(match[2]), total - 1);
    }
    if (start >= total || start > end) {
      headers.set("content-range", `bytes */${total}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("content-range", `bytes ${start}-${end}/${total}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(new Uint8Array(body.subarray(start, end + 1)), { status: 206, headers });
  }
  headers.set("content-length", String(total));
  return new Response(new Uint8Array(body), { status: 200, headers });
}

// ---------- মোছা ----------

/** একটা কাজের ফাইল মুছে দেয় (কাজ ফেলে দিলে) */
export async function releaseMedia(generationId: string) {
  const row = await db.aiGeneration.findUnique({
    where: { id: generationId },
    select: { mediaKeys: true },
  });
  if (!row?.mediaKeys.length) return;
  await deleteObjects(row.mediaKeys);
  await db.aiGeneration.update({ where: { id: generationId }, data: { mediaKeys: [] } });
}

/**
 * ৩০ দিনের পুরনো ফল: ফাইল মোছে আর ফলে "মেয়াদ শেষ" লেখে (প্রোডাক্টে বসানো ছবি Shopify-তেই থাকে)।
 * প্রতিদিনের পরিষ্কারের কাজ থেকে চলে; কতগুলো মুছল তা ফেরত দেয়।
 */
export async function pruneAiMedia(now = new Date(), batch = 200): Promise<number> {
  const cutoff = new Date(now.getTime() - MEDIA_RETENTION_DAYS * 86_400_000);
  const rows = await db.aiGeneration.findMany({
    where: { mediaKeys: { isEmpty: false }, createdAt: { lt: cutoff } },
    select: { id: true, mediaKeys: true, output: true },
    take: batch,
  });
  for (const row of rows) {
    await deleteObjects(row.mediaKeys);
    const output =
      row.output && typeof row.output === "object" && !Array.isArray(row.output)
        ? { ...(row.output as Record<string, unknown>), expired: true }
        : row.output;
    await db.aiGeneration.update({
      where: { id: row.id },
      data: {
        mediaKeys: [],
        ...(output ? { output: output as Prisma.InputJsonValue } : {}),
      },
    });
  }
  return rows.length;
}

/** দোকানের সব AI ফাইল মুছে দেয় (shop/redact); দোকানের সারি মোছার আগে ডাকতে হয় */
export async function deleteShopAiMedia(shopId: string) {
  for (;;) {
    const rows = await db.aiGeneration.findMany({
      where: { shopId, mediaKeys: { isEmpty: false } },
      select: { id: true, mediaKeys: true },
      take: 200,
    });
    if (rows.length === 0) return;
    await deleteObjects(rows.flatMap((row) => row.mediaKeys));
    await db.aiGeneration.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { mediaKeys: [] },
    });
  }
}
