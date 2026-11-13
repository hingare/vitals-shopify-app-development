import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  encryptPush,
  generateVapidKeys,
  isPushEndpoint,
  sendPush,
  validPushKeys,
  vapidAuthorization,
} from "./web-push.server";

const fromB64 = (value: string) => Buffer.from(value, "base64url");

/** RFC 8291, Appendix A-র উদাহরণ */
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** ব্রাউজারের দিকের কাজ: body খুলে মূল লেখা বের করা (RFC 8291 section 3.4) */
function decryptPush(body: Buffer, uaPrivate: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const keyLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + keyLength);
  const sealed = body.subarray(21 + keyLength);
  const ua = createECDH("prime256v1");
  ua.setPrivateKey(uaPrivate);
  const hkdf = (ikm: Buffer, hkdfSalt: Buffer, info: Buffer, length: number) =>
    Buffer.from(hkdfSync("sha256", ikm, hkdfSalt, info, length));
  const ikm = hkdf(
    ua.computeSecret(asPublic),
    auth,
    Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]),
    32,
  );
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(sealed.subarray(-16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, -1).toString("utf8");
}

describe("encryptPush", () => {
  it("produces exactly the message from the RFC 8291 example", () => {
    const body = encryptPush(
      RFC.plaintext,
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { salt: fromB64(RFC.salt), localPrivateKey: fromB64(RFC.asPrivate) },
    );
    expect(body.toString("base64url")).toBe(RFC.body);
  });

  it("uses a fresh key and salt each time, and the browser side can read it", () => {
    const browser = createECDH("prime256v1");
    browser.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const keys = {
      p256dh: browser.getPublicKey().toString("base64url"),
      auth: auth.toString("base64url"),
    };
    const text = JSON.stringify({ title: "নতুন অফার", body: "২০% ছাড়", url: "https://tom.com" });
    const first = encryptPush(text, keys);
    const second = encryptPush(text, keys);
    expect(first.equals(second)).toBe(false);
    expect(decryptPush(first, browser.getPrivateKey(), auth)).toBe(text);
    expect(decryptPush(second, browser.getPrivateKey(), auth)).toBe(text);
  });

  it("refuses a payload that would not fit in one push message", () => {
    expect(() => encryptPush("x".repeat(3001), { p256dh: RFC.uaPublic, auth: RFC.auth })).toThrow(
      "too large",
    );
  });
});

describe("validPushKeys", () => {
  it("accepts real browser keys and rejects malformed ones", () => {
    expect(validPushKeys({ p256dh: RFC.uaPublic, auth: RFC.auth })).toBe(true);
    expect(validPushKeys({ p256dh: RFC.uaPublic, auth: "c2hvcnQ" })).toBe(false);
    expect(validPushKeys({ p256dh: "BCVxsr7N", auth: RFC.auth })).toBe(false);
    // ঠিক মাপের, কিন্তু curve-এর উপর নয়
    const offCurve = Buffer.alloc(65, 1);
    offCurve[0] = 4;
    expect(validPushKeys({ p256dh: offCurve.toString("base64url"), auth: RFC.auth })).toBe(false);
  });
});

describe("vapidAuthorization", () => {
  it("signs a JWT for the push service that the public key verifies", () => {
    const keys = generateVapidKeys();
    const now = Date.parse("2026-11-10T10:00:00Z");
    const header = vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      keys,
      "https://tom.myshopify.com",
      now,
    );
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, k] = match!;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(fromB64(head!).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(fromB64(claims!).toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: now / 1000 + 12 * 3600,
      sub: "https://tom.myshopify.com",
    });
    const point = fromB64(keys.publicKey);
    const publicKey = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    });
    expect(fromB64(signature!)).toHaveLength(64);
    expect(
      verify(
        "sha256",
        Buffer.from(`${head}.${claims}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        fromB64(signature!),
      ),
    ).toBe(true);
  });
});

describe("isPushEndpoint", () => {
  it("accepts only the known push services over https", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=abc")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.test/x")).toBe(false);
    expect(isPushEndpoint("https://evilfcm.googleapis.com.test/x")).toBe(false);
    expect(isPushEndpoint("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isPushEndpoint("https://user@fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushEndpoint(42)).toBe(false);
  });
});

describe("sendPush", () => {
  const target = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    p256dh: RFC.uaPublic,
    auth: RFC.auth,
  };
  const vapid = { ...generateVapidKeys(), subject: "https://tom.myshopify.com" };

  it("posts an encrypted body with the push headers", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    expect(await sendPush(target, "hello", vapid, fetchFn)).toBe("sent");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(target.endpoint);
    const headers = init!.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.TTL).toBe("86400");
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    const body = Buffer.from(init!.body as Uint8Array);
    expect(decryptPush(body, fromB64(RFC.uaPrivate), fromB64(RFC.auth))).toBe("hello");
  });

  it("reports a subscription that no longer exists, and other failures", async () => {
    const status = (code: number) =>
      vi.fn<typeof fetch>(async () => new Response(null, { status: code }));
    expect(await sendPush(target, "x", vapid, status(410))).toBe("gone");
    expect(await sendPush(target, "x", vapid, status(404))).toBe("gone");
    expect(await sendPush(target, "x", vapid, status(429))).toBe("failed");
    expect(await sendPush(target, "x", vapid, status(500))).toBe("failed");
  });
});
