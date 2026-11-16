import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { signV4 } from "./sigv4";

/**
 * ফাইল রাখার জায়গা (এখন Visitor Recordings-এর রেকর্ড)। সার্ভারের .env ঠিক করে কোথায়:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET দিলে Cloudflare R2 (S3-এর মতো API,
 *   ডাউনলোডে খরচ নেই)। R2_ENDPOINT দিয়ে অন্য S3-সমতুল্য সার্ভিসও চলে।
 *   না দিলে লোকাল ডেভেলপমেন্টে প্রজেক্টের .data/objects ফোল্ডারে (OBJECT_STORE_DIR দিয়ে বদলানো যায়),
 *   আর প্রোডাকশনে "none": রেকর্ড হয় না, অ্যাডমিন সেটা স্পষ্ট করে বলে।
 * AWS SDK পুরোটা না এনে শুধু PUT, GET আর DELETE (sigv4.ts দিয়ে সই করা)।
 */
export type ObjectStoreKind = "r2" | "disk" | "none";

export function objectStoreKind(env: NodeJS.ProcessEnv = process.env): ObjectStoreKind {
  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET) {
    return "r2";
  }
  return env.NODE_ENV === "production" ? "none" : "disk";
}

type FetchFn = typeof fetch;
const defaultFetch: FetchFn = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) });
let fetchImpl: FetchFn = defaultFetch;

export function setObjectStoreFetchForTests(fn: FetchFn | null) {
  fetchImpl = fn ?? defaultFetch;
}

/** নামে শুধু সাধারণ অক্ষর; ".." বা শুরুতে "/" নয় (অন্য ফোল্ডারে লেখা বা পড়া আটকাতে) */
const KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,250}$/;
function checkKey(key: string) {
  if (
    !KEY.test(key) ||
    key.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Invalid object key: ${key}`);
  }
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

function r2Url(env: NodeJS.ProcessEnv, key: string) {
  const base = (env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(
    /\/+$/,
    "",
  );
  return `${base}/${env.R2_BUCKET}/${key}`;
}

async function r2(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer, type?: string) {
  const env = process.env;
  const url = r2Url(env, key);
  const payloadHash = sha256(body ?? "");
  const headers = signV4({
    method,
    url,
    headers: {
      "x-amz-content-sha256": payloadHash,
      ...(type ? { "content-type": type } : {}),
    },
    payloadHash,
    region: env.R2_REGION || "auto",
    service: "s3",
    accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
  });
  // Host সই করা আছে; fetch নিজেই URL থেকে একই Host পাঠায়
  delete headers.host;
  return fetchImpl(url, { method, headers, ...(body ? { body: new Uint8Array(body) } : {}) });
}

async function failed(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => "");
  throw new Error(`Object store ${what} failed: ${res.status} ${text.slice(0, 200)}`.trim());
}

function diskPath(key: string) {
  const root = resolve(process.env.OBJECT_STORE_DIR || join(process.cwd(), ".data", "objects"));
  const path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw new Error(`Invalid object key: ${key}`);
  return path;
}

export async function putObject(key: string, body: Buffer, type = "application/octet-stream") {
  checkKey(key);
  const kind = objectStoreKind();
  if (kind === "none") throw new Error("Object storage is not set up");
  if (kind === "disk") {
    const path = diskPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return;
  }
  const res = await r2("PUT", key, body, type);
  if (!res.ok) await failed(res, "write");
}

/** ফাইল না থাকলে null */
export async function getObject(key: string): Promise<Buffer | null> {
  checkKey(key);
  const kind = objectStoreKind();
  if (kind === "none") return null;
  if (kind === "disk") {
    try {
      return await readFile(diskPath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  const res = await r2("GET", key);
  if (res.status === 404) return null;
  if (!res.ok) await failed(res, "read");
  return Buffer.from(await res.arrayBuffer());
}

/** কয়েকটা একসাথে মোছে (R2-তে মোছায় খরচ নেই); না থাকলেও ভুল নয় */
export async function deleteObjects(keys: string[], concurrency = 6) {
  keys.forEach(checkKey);
  const kind = objectStoreKind();
  if (kind === "none" || keys.length === 0) return;
  const queue = [...keys];
  const worker = async () => {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      if (kind === "disk") {
        await rm(diskPath(key), { force: true });
        continue;
      }
      const res = await r2("DELETE", key);
      if (!res.ok && res.status !== 404) await failed(res, "delete");
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));
}
