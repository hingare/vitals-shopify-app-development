import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";
import { timedFetch } from "@app/integrations";

/**
 * Web Push পাঠানো, কোনো বাইরের লাইব্রেরি ছাড়া (Node-এর crypto দিয়ে):
 * - বার্তা এনক্রিপশন: RFC 8291 (aes128gcm)। ব্রাউজারের দেওয়া চাবি দিয়ে এনক্রিপ্ট হয়,
 *   তাই মাঝের push সার্ভিস (Google, Mozilla, Apple) বার্তার লেখা পড়তে পারে না।
 * - প্রেরকের পরিচয়: RFC 8292 (VAPID), প্রতিটা স্টোরের নিজের চাবি দিয়ে সই করা JWT।
 */
const b64 = (buf: Uint8Array) => Buffer.from(buf).toString("base64url");
const fromB64 = (value: string) => Buffer.from(value, "base64url");

export interface VapidKeys {
  /** uncompressed P-256 point (৬৫ বাইট), base64url */
  publicKey: string;
  /** ৩২ বাইট, base64url */
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(ecdh.getPrivateKey()) };
}

/** `Authorization: vapid t=<JWT>, k=<public key>` (JWT ১২ ঘণ্টা চলে; সীমা ২৪ ঘণ্টা) */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = Date.now(),
): string {
  const encode = (value: unknown) => b64(Buffer.from(JSON.stringify(value)));
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  })}`;
  const point = fromB64(keys.publicKey);
  // চাবির শুরুতে শূন্য বাইট থাকলে Node সেটা বাদ দিয়ে দেয়; JWK-তে পুরো ৩২ বাইটই লাগে
  const d = Buffer.concat([Buffer.alloc(32), fromB64(keys.privateKey)]).subarray(-32);
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64(point.subarray(1, 33)),
      y: b64(point.subarray(33, 65)),
      d: b64(d),
    },
    format: "jwk",
  });
  // JWT-র ES256 সই "r || s" আকারে (৬৪ বাইট), DER নয়
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64(signature)}, k=${keys.publicKey}`;
}

export interface PushKeys {
  p256dh: string;
  auth: string;
}

/** ব্রাউজারের চাবি ঠিক আকারের কিনা: p256dh = ৬৫ বাইটের P-256 point, auth = ১৬ বাইট */
export function validPushKeys(keys: PushKeys): boolean {
  const point = fromB64(keys.p256dh);
  if (point.length !== 65 || point[0] !== 4 || fromB64(keys.auth).length !== 16) return false;
  try {
    // point-টা সত্যিই curve-এর উপর কিনা (ভুল হলে computeSecret ছোড়ে)
    const probe = createECDH("prime256v1");
    probe.generateKeys();
    probe.computeSecret(point);
    return true;
  } catch {
    return false;
  }
}

const MAX_PAYLOAD = 3000;
const RECORD_SIZE = 4096;

/**
 * RFC 8291 অনুযায়ী এনক্রিপ্ট করা body (`Content-Encoding: aes128gcm`)।
 * `fixed` শুধু টেস্টের জন্য (RFC-র উদাহরণের সাথে মেলাতে); আসল পাঠানোয় প্রতিবার নতুন চাবি আর salt।
 */
export function encryptPush(
  payload: string,
  keys: PushKeys,
  fixed?: { salt: Buffer; localPrivateKey: Buffer },
): Buffer {
  const plain = Buffer.from(payload, "utf8");
  if (plain.length > MAX_PAYLOAD) throw new Error("Push payload too large");
  const uaPublic = fromB64(keys.p256dh);
  const authSecret = fromB64(keys.auth);

  const local = createECDH("prime256v1");
  if (fixed) local.setPrivateKey(fixed.localPrivateKey);
  else local.generateKeys();
  const asPublic = local.getPublicKey();
  const shared = local.computeSecret(uaPublic);

  const hkdf = (ikm: Buffer, salt: Buffer, info: Buffer, length: number) =>
    Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(shared, authSecret, keyInfo, 32);
  const salt = fixed?.salt ?? randomBytes(16);
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // শেষে 0x02 = "এটাই শেষ (ও একমাত্র) record"
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([plain, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, sealed]);
}

/**
 * শুধু পরিচিত push সার্ভিসের ঠিকানা মানা হয়। ঠিকানাটা ব্রাউজার থেকে আসে আর পরে আমাদের সার্ভার
 * সেখানে অনুরোধ পাঠায়, তাই যেকোনো ঠিকানা মানলে কেউ আমাদের সার্ভারকে ভেতরের নেটওয়ার্কে পাঠাতে পারত।
 */
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
];

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  return PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

export type PushOutcome = "sent" | "gone" | "failed";

export async function sendPush(
  target: { endpoint: string } & PushKeys,
  payload: string,
  vapid: VapidKeys & { subject: string },
  fetchFn: typeof fetch = timedFetch,
): Promise<PushOutcome> {
  const res = await fetchFn(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidAuthorization(target.endpoint, vapid, vapid.subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      // ক্রেতার ডিভাইস বন্ধ থাকলে push সার্ভিস এক দিন পর্যন্ত রেখে দেয়
      TTL: "86400",
      Urgency: "normal",
    },
    body: new Uint8Array(encryptPush(payload, target)),
  });
  // 404/410: ক্রেতা অনুমতি তুলে নিয়েছেন বা ব্রাউজার বদলেছেন; এই ঠিকানা আর কখনো কাজ করবে না
  if (res.status === 404 || res.status === 410) return "gone";
  return res.ok ? "sent" : "failed";
}
