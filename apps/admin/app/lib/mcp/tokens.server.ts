import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AI সহকারীর (MCP) টোকেন আর চাবি। ডাটাবেসে কখনো আসল টোকেন থাকে না, শুধু SHA-256;
 * তাই ডাটাবেস ফাঁস হলেও কেউ স্টোরে ঢুকতে পারে না। শুরুর অংশ দেখে চেনা যায় কোনটা কী
 * (ভুল জায়গায় পেস্ট হলে বা লগে এলে সহজে ধরা পড়ে)।
 */
export const PREFIX = {
  access: "mcp_at_",
  refresh: "mcp_rt_",
  key: "mcp_key_",
  code: "mcp_code_",
  secret: "mcp_cs_",
  client: "mcp_client_",
} as const;

export const newToken = (prefix: string, bytes = 32) =>
  `${prefix}${randomBytes(bytes).toString("base64url")}`;

export const hashToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

/** সময় দেখে আন্দাজ করা যায় না এমন তুলনা */
export function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** S256 challenge: ৩২ বাইটের SHA-256, base64url, padding ছাড়া = ঠিক ৪৩ অক্ষর */
export const isS256Challenge = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);

/** PKCE (RFC 7636): verifier-এর SHA-256 আগে পাঠানো challenge-এর সাথে মিলতে হবে */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return sameText(createHash("sha256").update(verifier, "ascii").digest("base64url"), challenge);
}
