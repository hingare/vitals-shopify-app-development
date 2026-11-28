import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAGIC,
  backupKey,
  decryptFile,
  encryptStream,
  isEncrypted,
  keyId,
} from "./backup-crypto.mjs";

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "backup-crypto-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** নকল ব্যাকআপ টুকরো টুকরো করে এনক্রিপ্ট করে ফাইলে লেখে (pg_dump যেভাবে পাঠায়) */
async function encrypt(plain, key, path) {
  const chunks = [];
  for (let i = 0; i < plain.length; i += 7_000) chunks.push(plain.subarray(i, i + 7_000));
  await pipeline(Readable.from(chunks), encryptStream(key), createWriteStream(path));
}

describe("backup encryption", () => {
  it("reads BACKUP_KEY as 32 bytes in base64 or hex, and nothing else", () => {
    const raw = randomBytes(32);
    expect(backupKey(raw.toString("base64"))).toEqual(raw);
    expect(backupKey(` ${raw.toString("hex")}\n`)).toEqual(raw);
    for (const bad of [
      undefined,
      "",
      "secret",
      randomBytes(16).toString("base64"),
      "z".repeat(64),
    ]) {
      expect(() => backupKey(bad)).toThrow(/32 random bytes/);
    }
  });

  it("names each key with a short id that differs between keys", () => {
    const a = randomBytes(32);
    expect(keyId(a)).toMatch(/^[0-9a-f]{12}$/);
    expect(keyId(Buffer.from(a))).toBe(keyId(a));
    expect(keyId(randomBytes(32))).not.toBe(keyId(a));
  });

  it("encrypts a dump so none of it is readable, and decrypts it back exactly", async () => {
    const key = randomBytes(32);
    const plain = Buffer.concat([
      Buffer.from("PGDMP customer anna@example.com +8801700000000 "),
      randomBytes(200_000),
    ]);
    const enc = join(dir, "x.dump.enc");
    await encrypt(plain, key, enc);

    const stored = await readFile(enc);
    expect(stored.length).toBe(MAGIC.length + 12 + plain.length + 16);
    expect(stored.subarray(0, MAGIC.length)).toEqual(MAGIC);
    expect(stored.includes(Buffer.from("anna@example.com"))).toBe(false);
    expect(stored.includes(Buffer.from("PGDMP"))).toBe(false);
    expect(await isEncrypted(enc)).toBe(true);

    const out = join(dir, "x.dump");
    await decryptFile(enc, out, key);
    expect(await readFile(out)).toEqual(plain);
  });

  it("uses a fresh IV every time, so the same dump never encrypts the same way", async () => {
    const key = randomBytes(32);
    const plain = Buffer.from("same dump");
    await encrypt(plain, key, join(dir, "a"));
    await encrypt(plain, key, join(dir, "b"));
    expect(await readFile(join(dir, "a"))).not.toEqual(await readFile(join(dir, "b")));
  });

  it("refuses a wrong key or a changed byte, and leaves no half-written file", async () => {
    const key = randomBytes(32);
    const enc = join(dir, "x.dump.enc");
    await encrypt(randomBytes(50_000), key, enc);
    const out = join(dir, "x.dump");

    await expect(decryptFile(enc, out, randomBytes(32))).rejects.toThrow(/wrong BACKUP_KEY/);
    expect(existsSync(out)).toBe(false);

    const damaged = await readFile(enc);
    damaged[30_000] ^= 1;
    await writeFile(enc, damaged);
    await expect(decryptFile(enc, out, key)).rejects.toThrow(/damaged/);
    expect(existsSync(out)).toBe(false);
  });

  it("tells a plain dump from an encrypted one", async () => {
    const plain = join(dir, "plain.dump");
    await writeFile(plain, "PGDMP plain custom-format dump");
    expect(await isEncrypted(plain)).toBe(false);
    await expect(decryptFile(plain, join(dir, "out"), randomBytes(32))).rejects.toThrow(
      /not an encrypted backup/,
    );
  });
});
