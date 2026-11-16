import { describe, expect, it } from "vitest";
import {
  BodyTooLargeError,
  directClientIp,
  ipKey,
  limitBody,
  proxyClientIp,
  readJson,
  readText,
} from "./request.server";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("https://app.example/x", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit);

/** content-length না জানিয়ে টুকরো টুকরো পাঠানো body */
const chunked = (chunks: number, size: number) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < chunks; i++) controller.enqueue(new Uint8Array(size).fill(97));
      controller.close();
    },
  });

const withIp = (forwardedFor: string, extra: Record<string, string> = {}) =>
  new Request("https://app.example/x", { headers: { "x-forwarded-for": forwardedFor, ...extra } });

describe("reading a body with a size limit", () => {
  it("reads text and JSON up to the limit", async () => {
    expect(await readText(post("hello"), 5)).toBe("hello");
    expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 });
    expect(await readText(new Request("https://app.example/x"), 5)).toBe("");
  });

  it("stops at the limit, whether or not the size was declared", async () => {
    expect(await readText(post("hello!"), 5)).toBeNull();
    expect(await readText(post(chunked(3, 4)), 10)).toBeNull();
    expect(await readText(post(chunked(2, 4)), 10)).toBe("aaaaaaaa");
    expect(await readJson(post(`{"a":"${"x".repeat(100)}"}`), 50)).toBeNull();
  });

  it("turns down a declared size over the limit without reading", async () => {
    const request = post(chunked(1, 4), { "content-length": "999999" });
    expect(await readText(request, 10)).toBeNull();
  });

  it("gives null for a body that isn't JSON", async () => {
    expect(await readJson(post("not json"))).toBeNull();
    expect(await readJson(post(""))).toBeNull();
  });

  it("lets a library read a limited copy of the request", async () => {
    const small = limitBody(post("ok", { "x-topic": "orders/paid" }), 10);
    expect(small.headers.get("x-topic")).toBe("orders/paid");
    expect(small.method).toBe("POST");
    expect(await small.text()).toBe("ok");
    await expect(limitBody(post(chunked(3, 8)), 10).text()).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });
});

describe("the IP used for rate limits", () => {
  it("keeps IPv4 and reduces IPv6 to its /64", () => {
    expect(ipKey("203.0.113.9")).toBe("203.0.113.9");
    expect(ipKey("2001:db8:85a3:1:2:8a2e:370:7334")).toBe("2001:db8:85a3:1::/64");
    expect(ipKey("2001:DB8:85a3:1::7334")).toBe("2001:db8:85a3:1::/64");
    expect(ipKey("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(ipKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipKey("64:ff9b::192.0.2.1")).toBe("64:ff9b:0:0::/64");
  });

  it("treats IPv4 written as IPv6 as IPv4", () => {
    expect(ipKey("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(ipKey("0:0:0:0:0:ffff:c633:6407")).toBe("198.51.100.7");
  });

  it("leaves anything that isn't an address as it is", () => {
    expect(ipKey("1:2:3")).toBe("1:2:3");
    expect(ipKey("1::2::3")).toBe("1::2::3");
    expect(ipKey("unknown")).toBe("unknown");
  });

  it("takes a direct caller's address from the right, so a made-up header can't change it", () => {
    const env = {};
    expect(directClientIp(withIp("203.0.113.9"), env)).toBe("203.0.113.9");
    expect(directClientIp(withIp("1.1.1.1, 2.2.2.2, 203.0.113.9"), env)).toBe("203.0.113.9");
    expect(
      directClientIp(withIp("1.1.1.1, 203.0.113.9, 10.0.0.2"), { TRUSTED_PROXY_COUNT: "2" }),
    ).toBe("203.0.113.9");
    expect(directClientIp(new Request("https://app.example/x"), env)).toBe("unknown");
  });

  it("uses the hosting's own client IP header when one is configured", () => {
    const env = { CLIENT_IP_HEADER: "fly-client-ip" };
    const request = withIp("1.1.1.1, 10.0.0.2", { "fly-client-ip": "203.0.113.9" });
    expect(directClientIp(request, env)).toBe("203.0.113.9");
    expect(directClientIp(withIp("1.1.1.1, 10.0.0.2"), env)).toBe("10.0.0.2");
  });

  it("takes the visitor's address that Shopify's app proxy wrote", () => {
    const env = {};
    // Shopify বসায় ভিজিটরের IP, তারপর আমাদের হোস্টিং Shopify-র ঠিকানা যোগ করে
    expect(proxyClientIp(withIp("203.0.113.9, 23.227.38.1"), env)).toBe("203.0.113.9");
    expect(proxyClientIp(withIp("6.6.6.6, 203.0.113.9, 23.227.38.1"), env)).toBe("203.0.113.9");
    expect(proxyClientIp(withIp("203.0.113.9"), { TRUSTED_PROXY_COUNT: "0" })).toBe("203.0.113.9");
    expect(
      proxyClientIp(withIp("203.0.113.9, 23.227.38.1"), { CLIENT_IP_HEADER: "fly-client-ip" }),
    ).toBe("203.0.113.9");
  });
});
