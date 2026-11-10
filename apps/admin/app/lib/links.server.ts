import { readToken, sign, signToken, verify } from "./crypto.server";

/**
 * ইমেইলের ভেতরের লিংক: খোলা গোনা, ক্লিক গোনা আর আনসাবস্ক্রাইব।
 * সব লিংক সই করা, তাই কেউ অন্যের ইমেইল আনসাবস্ক্রাইব করাতে বা আমাদের সার্ভারকে
 * ইচ্ছামতো ওয়েবসাইটে পাঠানোর কাজে (open redirect) লাগাতে পারে না।
 */
export const appUrl = () => (process.env.SHOPIFY_APP_URL ?? "").replace(/\/+$/, "");

export const openPixelUrl = (messageId: string) =>
  `${appUrl()}/e/o/${messageId}.${sign("open", messageId)}`;

export function readOpenToken(token: string): string | null {
  const [id, signature] = token.split(".");
  return id && signature && verify("open", id, signature) ? id : null;
}

export const clickUrl = (messageId: string, url: string) =>
  `${appUrl()}/e/c/${messageId}?u=${encodeURIComponent(url)}&s=${sign("click", `${messageId}|${url}`)}`;

export const isValidClick = (messageId: string, url: string, signature: string) =>
  /^https:\/\//.test(url) && verify("click", `${messageId}|${url}`, signature);

export const unsubscribeUrl = (shopId: string, email: string) =>
  `${appUrl()}/e/u/${signToken("unsub", [shopId, email])}`;

export function readUnsubscribeToken(token: string): { shopId: string; email: string } | null {
  const data = readToken<[string, string]>("unsub", token);
  if (!Array.isArray(data) || typeof data[0] !== "string" || typeof data[1] !== "string") {
    return null;
  }
  return { shopId: data[0], email: data[1] };
}

/** Push নোটিফিকেশনের ক্লিক গোনার লিংক */
export const pushClickUrl = (campaignId: string, url: string) =>
  `${appUrl()}/e/p/${campaignId}?u=${encodeURIComponent(url)}&s=${sign("push", `${campaignId}|${url}`)}`;

export const isValidPushClick = (campaignId: string, url: string, signature: string) =>
  /^https:\/\//.test(url) && verify("push", `${campaignId}|${url}`, signature);
