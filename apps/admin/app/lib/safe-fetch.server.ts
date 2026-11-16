import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";

/**
 * বাইরের পেজ আনার নিরাপদ পথ (AI Product Importer, Page Audit)। মার্চেন্টের দেওয়া URL দিয়ে
 * কেউ যেন আমাদের সার্ভারের ভেতরের ঠিকানায় (localhost, ক্লাউডের metadata, ভেতরের নেটওয়ার্ক) পৌঁছাতে না পারে:
 * - শুধু https, শুধু ৪৪৩ পোর্ট
 * - সংযোগের সময়েই ঠিকানা যাচাই (DNS বদলে ধোঁকা দেওয়া যায় না), প্রতিটা redirect-এও আবার
 * - আকার, সময় আর redirect-এর সীমা
 */
export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchBlockedError";
  }
}

const PRIVATE_V4: Array<[number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 (carrier NAT)
  [0x7f000000, 8], // 127/8
  [0xa9fe0000, 16], // 169.254/16 (link-local, cloud metadata)
  [0xac100000, 12], // 172.16/12
  [0xc0000000, 24], // 192.0.0/24
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // 198.18/15
  [0xe0000000, 3], // 224/3 (multicast, reserved)
];

function v4ToInt(ip: string) {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const n = v4ToInt(ip);
    return !PRIVATE_V4.some(([base, bits]) => ((n >>> (32 - bits)) << (32 - bits)) >>> 0 === base);
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicAddress(mapped[1] ?? "");
    if (lower === "::" || lower === "::1") return false;
    // fc00::/7 (ভেতরের), fe80::/10 (link-local), ff00::/8 (multicast)
    return !/^(f[cd]|fe[89ab]|ff)/.test(lower);
  }
  return false;
}

const checkedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as LookupAddress[];
    const safe = list.find((a) => isPublicAddress(a.address));
    if (!safe || list.some((a) => !isPublicAddress(a.address))) {
      return callback(new FetchBlockedError(`Blocked address for ${hostname}`), "", 0);
    }
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, [safe]);
    } else {
      callback(null, safe.address, safe.family);
    }
  });
};

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchBlockedError("Not a valid URL");
  }
  if (url.protocol !== "https:") throw new FetchBlockedError("Only https links are allowed");
  if (url.port && url.port !== "443")
    throw new FetchBlockedError("Only the standard port is allowed");
  if (url.username || url.password)
    throw new FetchBlockedError("Links with passwords are not allowed");
  if (
    isIP(url.hostname.replace(/^\[|\]$/g, "")) &&
    !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ""))
  ) {
    throw new FetchBlockedError("Private addresses are not allowed");
  }
  return url;
}

function getOnce(url: URL, maxBytes: number, timeoutMs: number) {
  return new Promise<{ status: number; location?: string; contentType: string; body: string }>(
    (resolve, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          lookup: checkedLookup,
          timeout: timeoutMs,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; StoreToolsBot/1.0)",
            Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
            "Accept-Encoding": "identity",
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const contentType = String(res.headers["content-type"] ?? "");
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            resolve({ status, location: res.headers.location, contentType, body: "" });
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              req.destroy(new FetchBlockedError("The page is too large"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () =>
            resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }),
          );
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new FetchBlockedError("The page took too long")));
      req.on("error", reject);
      req.end();
    },
  );
}

export async function safeFetch(
  raw: string,
  options: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {},
): Promise<SafeFetchResult> {
  const { maxBytes = 2_000_000, timeoutMs = 10_000, maxRedirects = 3 } = options;
  let url = checkUrl(raw);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const result = await getOnce(url, maxBytes, timeoutMs);
    if (result.location === undefined) {
      return {
        url: url.toString(),
        status: result.status,
        contentType: result.contentType,
        body: result.body,
      };
    }
    url = checkUrl(new URL(result.location, url).toString());
  }
  throw new FetchBlockedError("Too many redirects");
}
