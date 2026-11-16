/**
 * বাইরে থেকে আসা অনুরোধ নিরাপদে পড়া: body-র আকার বাঁধা, আর রেট লিমিটের জন্য অনুরোধকারীর IP।
 * কেউ বিশাল body পাঠিয়ে সার্ভারের মেমরি ভরাতে পারে না, আর নকল হেডার দিয়ে রেট লিমিটও এড়াতে পারে না।
 */

type Env = Record<string, string | undefined>;

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large");
    this.name = "BodyTooLargeError";
  }
}

const declaredSize = (request: Request) => Number(request.headers.get("content-length") ?? 0);

/**
 * একই অনুরোধ, তবে body সীমা ছাড়ালেই পড়া থেমে BodyTooLargeError হয়।
 * যে লাইব্রেরি নিজেই পুরো body পড়ে (যেমন Shopify-র webhook যাচাই), তাকে এটা দিন।
 */
export function limitBody(request: Request, maxBytes: number): Request {
  if (!request.body) return request;
  // আগে ঘোষিত আকার, তারপর পড়তে পড়তে গোনা (ঘোষণা না থাকলে বা ভুল হলেও)
  let size = declaredSize(request) > maxBytes ? Infinity : 0;
  const body = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > maxBytes) controller.error(new BodyTooLargeError());
        else controller.enqueue(chunk);
      },
    }),
  );
  return new Request(request, { body, duplex: "half" } as RequestInit);
}

/** body টেক্সট হিসেবে। বড় হলে পুরোটা মেমরিতে তোলার আগেই থামে, তখন বা পড়া না গেলে null; body না থাকলে "" */
export async function readText(request: Request, maxBytes: number): Promise<string | null> {
  if (declaredSize(request) > maxBytes) return null;
  try {
    return await limitBody(request, maxBytes).text();
  } catch {
    return null;
  }
}

/** JSON body (বড়, ফাঁকা বা ভুল হলে null) */
export async function readJson(request: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const text = await readText(request, maxBytes);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * রেট লিমিটের চাবি হিসেবে IP। IPv6-এ একজন সাধারণত পুরো একটা /64 পায় আর তার ভেতরে
 * ইচ্ছামতো ঠিকানা বদলাতে পারে, তাই প্রথম ৬৪ বিটই তার পরিচয়। IPv4 যেমন আছে তেমন।
 */
export function ipKey(ip: string): string {
  const value = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "");
  if (!value.includes(":")) return value;
  const full = ipv6Groups(value);
  if (!full) return value;
  // IPv4-এর ঠিকানা IPv6 রূপে (::ffff:1.2.3.4): আসলে IPv4
  if (full.slice(0, 5).every((group) => group === 0) && full[5] === 0xffff) {
    const [hi, lo] = [full[6] as number, full[7] as number];
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  }
  return `${full
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/** IPv6 ঠিকানার আটটা ১৬-বিট অংশ (ভুল ঠিকানা হলে null) */
function ipv6Groups(value: string): number[] | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parts = (half: string | undefined) => {
    if (!half) return [];
    const list = half.split(":");
    // শেষে IPv4 লেখা থাকলে (যেমন 64:ff9b::1.2.3.4) সেটা দুটো অংশ
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(list[list.length - 1] ?? "");
    if (v4) {
      const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
      if ([a, b, c, d].some((n) => n > 255)) return null;
      list.splice(-1, 1, ((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
    }
    return list;
  };
  const left = parts(halves[0]);
  const right = parts(halves[1]);
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (!all.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return all.map((group) => parseInt(group, 16));
}

/**
 * X-Forwarded-For-এর বাঁ দিকটা ক্লায়েন্ট নিজেই লিখে পাঠাতে পারে, তাই ঠিকানা ডান দিক থেকে গোনা হয়:
 * আমাদের হোস্টিং-এর প্রক্সিগুলো (TRUSTED_PROXY_COUNT, ডিফল্ট ১) যা যোগ করেছে, তার আগেরটা।
 */
function forwardedAddress(request: Request, env: Env, extraHops: number): string | null {
  const chain = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const configured = Number(env.TRUSTED_PROXY_COUNT?.trim() || "1");
  const proxies = Number.isInteger(configured) && configured >= 0 ? configured : 1;
  return chain[Math.max(chain.length - proxies - extraHops, 0)] ?? null;
}

/**
 * সরাসরি অ্যাপের ঠিকানায় আসা অনুরোধের IP (MCP লগইন, Web Pixel)। হোস্টিং যদি আলাদা হেডারে আসল IP দেয়
 * যেটা ক্লায়েন্ট বদলাতে পারে না (Fly: fly-client-ip, Cloudflare: cf-connecting-ip), CLIENT_IP_HEADER-এ সেই নাম দিন।
 */
export function directClientIp(request: Request, env: Env = process.env): string {
  const header = env.CLIENT_IP_HEADER?.trim();
  const ip = (header && request.headers.get(header)?.trim()) || forwardedAddress(request, env, 0);
  return ip ? ipKey(ip) : "unknown";
}

/**
 * Shopify App Proxy হয়ে আসা স্টোরফ্রন্ট অনুরোধে ভিজিটরের IP। Shopify ভিজিটরের IP X-Forwarded-For-এ বসায়,
 * তারপর আমাদের হোস্টিং Shopify-র নিজের ঠিকানা যোগ করে, তাই এখানে এক ধাপ বেশি গোনা হয়।
 * CLIENT_IP_HEADER এখানে খাটে না: সেটা ভিজিটরের নয়, Shopify-র ঠিকানা।
 */
export function proxyClientIp(request: Request, env: Env = process.env): string {
  const ip = forwardedAddress(request, env, 1);
  return ip ? ipKey(ip) : "unknown";
}
