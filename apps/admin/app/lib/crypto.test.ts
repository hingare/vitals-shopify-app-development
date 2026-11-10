import { beforeAll, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  readSecretJson,
  readToken,
  sign,
  signToken,
  verify,
} from "./crypto.server";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("secrets", () => {
  it("encrypts so the stored value never contains the key, and decrypts back", () => {
    const stored = encryptSecret("pk_live_abc123");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain("pk_live_abc123");
    expect(decryptSecret(stored)).toBe("pk_live_abc123");
  });

  it("uses a fresh IV every time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a changed value instead of returning garbage", () => {
    const [version, iv, tag, data] = encryptSecret("secret").split(".");
    const flipped = Buffer.from(data ?? "", "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const tampered = [version, iv, tag, flipped.toString("base64url")].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
    expect(readSecretJson(tampered)).toBeNull();
  });

  it("cannot be read with another key", () => {
    const stored = encryptSecret(JSON.stringify({ apiKey: "k" }));
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(readSecretJson(stored)).toBeNull();
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    expect(readSecretJson(stored)).toEqual({ apiKey: "k" });
  });

  it("refuses a key of the wrong length", () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("shows only the last 4 characters", () => {
    expect(maskSecret("pk_live_abc123")).toBe("••••c123");
    expect(maskSecret("abc")).toBe("••••");
  });
});

describe("signatures", () => {
  it("verifies its own signature and nothing else", () => {
    const signature = sign("click", "m1|https://shop.com");
    expect(verify("click", "m1|https://shop.com", signature)).toBe(true);
    expect(verify("click", "m1|https://evil.com", signature)).toBe(false);
    // অন্য কাজের সই এখানে চলে না
    expect(verify("open", "m1|https://shop.com", signature)).toBe(false);
    expect(verify("click", "m1|https://shop.com", "")).toBe(false);
  });

  it("round-trips a signed token and rejects an edited one", () => {
    const token = signToken("unsub", ["shop1", "a@b.com"]);
    expect(readToken("unsub", token)).toEqual(["shop1", "a@b.com"]);
    const [body, signature] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify(["shop1", "victim@b.com"])).toString("base64url")}.${signature}`;
    expect(readToken("unsub", forged)).toBeNull();
    expect(readToken("unsub", `${body}.`)).toBeNull();
    expect(readToken("unsub", "nonsense")).toBeNull();
  });
});
