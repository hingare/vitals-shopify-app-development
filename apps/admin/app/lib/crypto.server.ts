import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * গোপন তথ্য রাখার ও লিংক সই করার একটাই জায়গা।
 * - বাইরের সার্ভিসের API key ডাটাবেসে AES-256-GCM-এ এনক্রিপ্ট হয়ে থাকে।
 * - ইমেইলের আনসাবস্ক্রাইব/ক্লিক লিংক HMAC দিয়ে সই করা, তাই কেউ অন্যের হয়ে লিংক বানাতে পারে না।
 *
 * মূল চাবি: APP_ENCRYPTION_KEY (৩২ বাইট, base64)। না দিলে SHOPIFY_API_SECRET থেকে বের করা হয়,
 * যাতে লোকাল ডেভেলপমেন্টে আলাদা কিছু বসাতে না হয়। প্রোডাকশনে APP_ENCRYPTION_KEY দিন:
 * তাহলে Shopify-র secret বদলালেও সেভ করা চাবিগুলো পড়া যাবে।
 */
function rootSecret(): Buffer {
  const explicit = process.env.APP_ENCRYPTION_KEY;
  if (explicit) {
    const key = Buffer.from(explicit, "base64");
    if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes in base64");
    return key;
  }
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("Set APP_ENCRYPTION_KEY or SHOPIFY_API_SECRET");
  return Buffer.from(secret, "utf8");
}

function derive(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", rootSecret(), "app-keys-v1", purpose, 32));
}

const b64 = (buf: Buffer) => buf.toString("base64url");

/** "v1.<iv>.<tag>.<data>": সংস্করণ রাখা আছে, যাতে পরে চাবি বা পদ্ধতি বদলানো যায় */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive("secrets"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", b64(iv), b64(cipher.getAuthTag()), b64(data)].join(".");
}

/** ভুল চাবি বা বদলানো ডেটা হলে error ছোড়ে (GCM নিজেই যাচাই করে) */
export function decryptSecret(token: string): string {
  const [version, iv, tag, data] = token.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unreadable secret");
  const decipher = createDecipheriv("aes-256-gcm", derive("secrets"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** এনক্রিপ্ট করা JSON পড়ে; পড়া না গেলে null */
export function readSecretJson<T>(token: string | null | undefined): T | null {
  if (!token) return null;
  try {
    return JSON.parse(decryptSecret(token)) as T;
  } catch {
    return null;
  }
}

/** লিংকের সই: ১২৮ বিট, URL-এ বসানোর মতো ছোট */
export function sign(purpose: string, value: string): string {
  return b64(
    createHmac("sha256", derive(`sign:${purpose}`))
      .update(value)
      .digest()
      .subarray(0, 16),
  );
}

export function verify(purpose: string, value: string, signature: string): boolean {
  const expected = Buffer.from(sign(purpose, value));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** "payload.signature" টোকেন (payload base64url JSON) */
export function signToken(purpose: string, payload: unknown): string {
  const body = b64(Buffer.from(JSON.stringify(payload)));
  return `${body}.${sign(purpose, body)}`;
}

export function readToken<T>(purpose: string, token: string): T | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  if (!verify(purpose, body, token.slice(dot + 1))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/** চাবির শেষ ৪ অক্ষর ছাড়া বাকি ঢেকে দেয় (অ্যাডমিনে দেখানোর জন্য) */
export function maskSecret(value: string): string {
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}
