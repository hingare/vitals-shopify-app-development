/**
 * ব্যাকআপ ফাইলের এনক্রিপশন (AES-256-GCM, Node-এর নিজের crypto; বাইরের কোনো টুল লাগে না)।
 * ব্যাকআপে ক্রেতাদের ইমেইল, নাম আর ফোন থাকে, আর Shopify-র protected customer data-র শর্তে ব্যাকআপ
 * এনক্রিপ্ট করা বাধ্যতামূলক। চাবি থাকে BACKUP_KEY-তে; কীভাবে বানাবেন: docs/backup-restore.md
 *
 * ফাইলের গঠন: MAGIC (৮ বাইট) | IV (১২) | এনক্রিপ্ট করা pg_dump | GCM tag (১৬)।
 * tag পুরো ফাইলের সত্যতা প্রমাণ করে: ভুল চাবি বা একটা বাইটও বদলালে খোলা যায় না।
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAGIC = Buffer.from("BAKENC01");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES;

/** BACKUP_KEY থেকে ৩২ বাইটের চাবি: base64 (৪৪ অক্ষর) বা hex (৬৪ অক্ষর) */
export function backupKey(text) {
  const value = String(text ?? "").trim();
  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) key = Buffer.from(value, "hex");
  else if (/^[A-Za-z0-9+/]{43}=?$/.test(value)) key = Buffer.from(value, "base64");
  if (!key || key.length !== 32) {
    throw new Error(
      "BACKUP_KEY must be 32 random bytes in base64 (44 characters) or hex (64 characters). " +
        "See docs/backup-restore.md for the command that makes one.",
    );
  }
  return key;
}

/** চাবির ছোট পরিচয় (.json-এ লেখা থাকে): রিস্টোরে ভুল চাবি দিলে খোলার আগেই বলা যায় */
export function keyId(key) {
  return createHash("sha256").update("backup-key-id:").update(key).digest("hex").slice(0, 12);
}

/** pg_dump-এর আউটপুট এর ভেতর দিয়ে গেলে এনক্রিপ্ট হয়ে বেরোয় (খোলা লেখা ডিস্কে নামে না) */
export function encryptStream(key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let started = false;
  const start = (stream) => {
    if (!started) {
      started = true;
      stream.push(Buffer.concat([MAGIC, iv]));
    }
  };
  return new Transform({
    transform(chunk, _encoding, done) {
      start(this);
      done(null, cipher.update(chunk));
    },
    flush(done) {
      start(this);
      this.push(cipher.final());
      done(null, cipher.getAuthTag());
    },
  });
}

/** ফাইলটা এই এনক্রিপশনে কিনা (শুরুর MAGIC দেখে) */
export async function isEncrypted(path) {
  const file = await open(path, "r");
  try {
    const head = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await file.read(head, 0, MAGIC.length, 0);
    return bytesRead === MAGIC.length && head.equals(MAGIC);
  } finally {
    await file.close();
  }
}

/**
 * এনক্রিপ্ট করা ব্যাকআপ খুলে `dest`-এ লেখে (শুধু মালিক পড়তে পারে এমন ফাইল)।
 * ভুল চাবি বা ক্ষতিগ্রস্ত ফাইল হলে অর্ধেক লেখা `dest` মুছে error দেয়।
 */
export async function decryptFile(src, dest, key) {
  const file = await open(src, "r");
  let iv;
  let tag;
  let size;
  try {
    size = (await file.stat()).size;
    const head = Buffer.alloc(HEADER_BYTES);
    await file.read(head, 0, HEADER_BYTES, 0);
    if (size < HEADER_BYTES + TAG_BYTES || !head.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error(`${src} is not an encrypted backup`);
    }
    iv = head.subarray(MAGIC.length);
    tag = Buffer.alloc(TAG_BYTES);
    await file.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await file.close();
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    const body = size - TAG_BYTES > HEADER_BYTES;
    await pipeline(
      body
        ? createReadStream(src, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 })
        : [Buffer.alloc(0)],
      decipher,
      createWriteStream(dest, { mode: 0o600 }),
    );
  } catch (error) {
    await rm(dest, { force: true });
    if (error instanceof Error && /auth|decrypt/i.test(error.message)) {
      throw new Error("cannot decrypt the backup: wrong BACKUP_KEY, or the file is damaged");
    }
    throw error;
  }
}
