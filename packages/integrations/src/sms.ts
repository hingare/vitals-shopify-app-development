import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { FetchFn } from "./types";

/**
 * SMS gateway। মার্চেন্ট নিজের gateway অ্যাকাউন্টের চাবি দেন, তাই SMS-এর খরচ সরাসরি তার অ্যাকাউন্ট থেকে যায়।
 * তিনটা বাংলাদেশি gateway আগে থেকে সাজানো, আর অন্য যেকোনোটার জন্য "custom" (নিজের HTTPS লিংক)।
 */
export const SMS_GATEWAYS = ["alpha-sms", "ssl-wireless", "bulksmsbd", "custom"] as const;
export type SmsGatewayId = (typeof SMS_GATEWAYS)[number];

export interface SmsConfig {
  gateway: SmsGatewayId;
  apiKey: string;
  senderId?: string;
  /** শুধু custom: https লিংক, যেখানে {to} {message} {api_key} {sender_id} বসে */
  customUrl?: string;
  /** শুধু custom: উত্তরে এই লেখা থাকলে সফল (ফাঁকা হলে HTTP 2xx-ই যথেষ্ট) */
  customSuccess?: string;
}

export interface SmsResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** true হলে আবার চেষ্টা করে লাভ নেই (ভুল চাবি, ব্যালেন্স নেই, ভুল নম্বর) */
  permanent?: boolean;
}

/**
 * ফোন নম্বর gateway-র উপযোগী করে: শুধু সংখ্যা, দেশের কোড আগে (BD: 8801XXXXXXXXX)।
 * ভুল হলে null। বাংলাদেশের জন্য অপারেটরের কোডও যাচাই হয় (013 থেকে 019)।
 */
export function normalizePhone(raw: unknown, countryCode = "BD"): string | null {
  if (typeof raw !== "string") return null;
  // বাংলা সংখ্যা (০-৯) ইংরেজিতে
  let digits = raw
    .replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6))
    .replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(digits)) return null;
  digits = digits.replace(/^\+/, "").replace(/^00/, "");
  if (countryCode.toUpperCase() === "BD") {
    if (/^01[3-9]\d{8}$/.test(digits)) digits = `88${digits}`;
    return /^8801[3-9]\d{8}$/.test(digits) ? digits : null;
  }
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/** GSM-7 অক্ষরে ১৬০, অন্য যেকোনো অক্ষর (বাংলা) থাকলে ৭০ করে এক SMS */
export function smsSegments(text: string): number {
  // eslint-disable-next-line no-control-regex
  const gsm = /^[\x00-\x7F£¥èéùìòÇØøÅåΔΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]*$/.test(text);
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

const form = (params: Record<string, string>) => new URLSearchParams(params).toString();

async function alphaSms(config: SmsConfig, to: string, text: string, fetchFn: FetchFn) {
  // Docs: https://sms.bd/api  সফল হলে {"error":0,...}
  const res = await fetchFn("https://api.sms.net.bd/sendsms", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      api_key: config.apiKey,
      msg: text,
      to,
      ...(config.senderId ? { sender_id: config.senderId } : {}),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: number | string;
    msg?: string;
    data?: { request_id?: number | string };
  };
  if (res.ok && Number(json.error) === 0)
    return { ok: true, id: String(json.data?.request_id ?? "") };
  return {
    ok: false,
    error: `${json.error ?? res.status} ${json.msg ?? ""}`.trim(),
    // 409 = gateway-র সাময়িক সমস্যা; বাকিগুলো (চাবি, ব্যালেন্স, নম্বর) আবার চেষ্টায় ঠিক হয় না
    permanent: Number(json.error) !== 409 && res.status < 500,
  };
}

async function sslWireless(config: SmsConfig, to: string, text: string, fetchFn: FetchFn) {
  const res = await fetchFn("https://smsplus.sslwireless.com/api/v3/send-sms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      api_token: config.apiKey,
      sid: config.senderId ?? "",
      msisdn: to,
      sms: text,
      // প্রতিটা SMS-এর নিজস্ব id (সর্বোচ্চ ২০ অক্ষর) gateway চায়
      csms_id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 20),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    status_code?: number;
    error_message?: string;
    smsinfo?: Array<{ sms_id?: string }>;
  };
  if (res.ok && json.status === "SUCCESS") return { ok: true, id: json.smsinfo?.[0]?.sms_id };
  return {
    ok: false,
    error: `${json.status_code ?? res.status} ${json.error_message ?? ""}`.trim(),
    permanent: res.status < 500,
  };
}

async function bulkSmsBd(config: SmsConfig, to: string, text: string, fetchFn: FetchFn) {
  // সফল হলে response_code 202
  const res = await fetchFn("https://bulksmsbd.net/api/smsapi", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      api_key: config.apiKey,
      type: "text",
      number: to,
      senderid: config.senderId ?? "",
      message: text,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    response_code?: number | string;
    message_id?: number | string;
    error_message?: string;
  };
  if (res.ok && Number(json.response_code) === 202) {
    return { ok: true, id: String(json.message_id ?? "") };
  }
  return {
    ok: false,
    error: `${json.response_code ?? res.status} ${json.error_message ?? ""}`.trim(),
    permanent: res.status < 500,
  };
}

/* ------------------------------------------------------------------ */
/* Custom gateway: মার্চেন্টের দেওয়া লিংক, তাই বাড়তি সাবধানতা           */
/* ------------------------------------------------------------------ */

/** আমাদের নিজেদের নেটওয়ার্ক বা লোকাল ঠিকানা কিনা (এসব জায়গায় অনুরোধ পাঠানো নিষেধ) */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase();
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (ip.startsWith("::ffff:")) return isPrivateAddress(ip.slice(7));
  return (
    ip === "::" ||
    ip === "::1" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe8") ||
    ip.startsWith("fe9") ||
    ip.startsWith("fea") ||
    ip.startsWith("feb") ||
    ip.startsWith("ff")
  );
}

/** {to} {message} {api_key} {sender_id} বসিয়ে লিংক বানায়; https না হলে বা ভুল হলে null */
export function buildCustomUrl(config: SmsConfig, to: string, text: string): URL | null {
  const values: Record<string, string> = {
    to,
    message: text,
    api_key: config.apiKey,
    sender_id: config.senderId ?? "",
  };
  const filled = (config.customUrl ?? "").replace(/\{(to|message|api_key|sender_id)\}/g, (_, k) =>
    encodeURIComponent(values[k as string] ?? ""),
  );
  try {
    const url = new URL(filled);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export interface HttpsResult {
  status: number;
  body: string;
}
export type HttpsGet = (url: URL, address: string, family: number) => Promise<HttpsResult>;

/** নির্দিষ্ট IP-তে HTTPS GET (নাম আবার খোঁজা হয় না, তাই যাচাইয়ের পরে ঠিকানা বদলে ফেলা যায় না) */
const pinnedGet: HttpsGet = (url, address, family) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        timeout: 10_000,
        lookup: (_host, _options, callback) => callback(null, address, family),
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (body.length < 4096) body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });

type Resolve = (host: string) => Promise<Array<{ address: string; family: number }>>;
const resolveAll: Resolve = (host) => dnsLookup(host, { all: true });

async function customGateway(
  config: SmsConfig,
  to: string,
  text: string,
  get: HttpsGet = pinnedGet,
  resolve: Resolve = resolveAll,
): Promise<SmsResult> {
  const url = buildCustomUrl(config, to, text);
  if (!url)
    return { ok: false, error: "The gateway link must start with https://", permanent: true };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  const target = addresses[0];
  if (!target || addresses.some((a) => isPrivateAddress(a.address))) {
    return { ok: false, error: "That gateway address is not allowed", permanent: true };
  }
  const res = await get(url, target.address, target.family);
  // redirect অনুসরণ করা হয় না (অন্য ঠিকানায় নিয়ে যেতে পারে)
  const ok =
    res.status >= 200 &&
    res.status < 300 &&
    (!config.customSuccess || res.body.includes(config.customSuccess));
  return ok
    ? { ok: true }
    : {
        ok: false,
        error: `${res.status} ${res.body.slice(0, 120)}`.trim(),
        permanent: res.status < 500,
      };
}

export interface SmsDeps {
  fetchFn?: FetchFn;
  get?: HttpsGet;
  resolve?: Resolve;
}

/** to: normalizePhone থেকে পাওয়া নম্বর */
export async function sendSms(
  config: SmsConfig,
  to: string,
  text: string,
  deps: SmsDeps = {},
): Promise<SmsResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  try {
    switch (config.gateway) {
      case "alpha-sms":
        return await alphaSms(config, to, text, fetchFn);
      case "ssl-wireless":
        return await sslWireless(config, to, text, fetchFn);
      case "bulksmsbd":
        return await bulkSmsBd(config, to, text, fetchFn);
      case "custom":
        return await customGateway(config, to, text, deps.get, deps.resolve);
      default:
        return { ok: false, error: "Unknown gateway", permanent: true };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
