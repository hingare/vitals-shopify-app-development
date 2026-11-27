import { execFileSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createSecureServer, type Http2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { ASSETS, PATHS, createStore, type Store, type StoreOptions } from "./store";
import { WEIGHT_ASSETS } from "./weight";

/**
 * নকল দোকান একটা আসল সার্ভারে (Lighthouse-এর জন্য, যা Playwright-এর route দেখে না)।
 * Shopify-র মতো HTTPS + HTTP/2 আর brotli: Lighthouse-এর হিসাব (simulated throttling) সংযোগের ধরন আর
 * কত বাইট আসে তা দেখেই সময় ধরে, তাই HTTP/1.1 বা না-চাপা ফাইলে আমাদের খরচ আসলের চেয়ে বেশি দেখাত।
 * সার্টিফিকেট নিজে বানানো (openssl), Chrome-কে সেটা বিশ্বাস করাতে `spki` দিয়ে
 * --ignore-certificate-errors-spki-list চালু করতে হয়।
 */
export interface Served {
  origin: string;
  store: Store;
  close(): Promise<void>;
}

interface Certificate {
  key: Buffer;
  cert: Buffer;
  /** সার্টিফিকেটের public key-এর sha256 (base64), Chrome-এর flag-এর জন্য */
  spki: string;
}

let certificate: Certificate | null = null;

/** একবার বানানো, সব সার্ভারে একই */
export function tls(): Certificate {
  if (certificate) return certificate;
  const dir = mkdtempSync(join(tmpdir(), "store-tls-"));
  try {
    const key = join(dir, "key.pem");
    const cert = join(dir, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "2",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:localhost",
      ],
      { stdio: "pipe" },
    );
    const pem = readFileSync(cert);
    const der = createPublicKey(pem).export({ type: "spki", format: "der" });
    certificate = {
      key: readFileSync(key),
      cert: pem,
      spki: createHash("sha256").update(der).digest("base64"),
    };
    return certificate;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * স্থির ফাইল (/cdn/...) একবার সবচেয়ে ভালোভাবে চেপে রাখা হয়, CDN যেমন রাখে; পাতা আর JSON প্রতিবার
 * দ্রুত চাপা হয়। চাপতে সময় লাগলে Lighthouse সেটাকে সার্ভারের ধীরতা ধরে নিত, তাই সার্ভার চালুর সময়েই
 * সব স্থির ফাইল চেপে রাখা হয় (warm)।
 */
const compressed = new Map<string, Buffer>();

function brotli(body: Buffer, still: boolean): Buffer {
  if (!still) {
    return brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
  }
  const key = createHash("sha1").update(body).digest("hex");
  let out = compressed.get(key);
  if (!out) {
    out = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
    compressed.set(key, out);
  }
  return out;
}

const TEXT = /^(text\/|application\/(javascript|json))/;

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

async function answer(
  store: Store,
  origin: string,
  method: string,
  path: string,
  raw: string | null,
  accepts: string,
): Promise<Answer> {
  const reply = await store.respond({ method, url: origin + path, body: raw });
  let body = typeof reply.body === "string" ? Buffer.from(reply.body) : reply.body;
  const headers: Record<string, string> = { "content-type": reply.contentType };
  if (TEXT.test(reply.contentType) && /\bbr\b/.test(accepts) && body.length > 0) {
    body = brotli(body, path.startsWith("/cdn/"));
    headers["content-encoding"] = "br";
  }
  return { status: reply.status, headers, body };
}

/** নকল দোকান চালু করা; বন্ধ করতে close() */
export async function serveStore(options: StoreOptions): Promise<Served> {
  const { key, cert } = tls();
  const sessions = new Set<Http2Session>();
  let store: Store | null = null;
  let origin = "";

  const server = createSecureServer({ key, cert, allowHTTP1: true }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : null;
      answer(
        store!,
        origin,
        req.method ?? "GET",
        req.url ?? "/",
        raw,
        String(req.headers["accept-encoding"] ?? ""),
      )
        .then(({ status, headers, body }) => {
          res.writeHead(status, headers);
          res.end(body);
        })
        .catch((error: unknown) => {
          res.writeHead(500, { "content-type": "text/plain" });
          res.end(String(error));
        });
    });
  });
  server.on("session", (session) => {
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  store = createStore(options, origin);

  // আগেভাগে একবার: সব স্থির ফাইল চাপা আর প্রতিটা পাতা একবার বানানো (Liquid গরম হয়)
  const still = [
    ...readdirSync(ASSETS).map((file) => `/cdn/assets/${file}`),
    ...(options.weight ? Object.keys(WEIGHT_ASSETS) : []),
  ];
  for (const path of [...still, ...Object.values(PATHS)]) {
    await answer(store, origin, "GET", path, null, "br");
  }

  return {
    origin,
    store,
    close: () =>
      new Promise<void>((resolve) => {
        // Chrome HTTP/2 সংযোগ খোলা রাখে; না কাটলে server.close() শেষ হয় না
        for (const session of sessions) session.destroy();
        server.close(() => resolve());
      }),
  };
}
