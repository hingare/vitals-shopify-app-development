/**
 * AI সহকারীর (MCP) আর তার লগইনের (OAuth) ঠিকানাগুলোর সাধারণ HTTP অংশ।
 * সহকারীরা সাধারণত নিজের সার্ভার থেকে ডাকে, তবে ব্রাউজারে চলা ক্লায়েন্টের জন্য CORS খোলা রাখা হয়।
 * কুকি দিয়ে কিছু হয় না, শুধু Bearer টোকেন, তাই সব origin-কে উত্তর দেখতে দেওয়া নিরাপদ।
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

/** ব্রাউজারের OPTIONS (preflight); React Router এটা loader-এ পাঠায় */
export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });

export function jsonReply(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

export const methodNotAllowed = (allow: string) =>
  new Response(null, { status: 405, headers: { ...CORS_HEADERS, Allow: allow } });

/** body পড়ে, তবে বড় হলে পুরোটা মেমরিতে তোলার আগেই থামে (null) */
export async function readBody(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString("utf8");
}

/**
 * OAuth-এর ফর্ম (application/x-www-form-urlencoded)। কিছু ক্লায়েন্ট JSON পাঠায়, সেটাও মেনে নেওয়া হয়।
 * পড়া না গেলে null।
 */
export async function readForm(
  request: Request,
  maxBytes = 16_384,
): Promise<URLSearchParams | null> {
  const text = await readBody(request, maxBytes);
  if (text === null) return null;
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return new URLSearchParams(text);
  }
  try {
    const body = JSON.parse(text) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") form.set(key, value);
    }
    return form;
  } catch {
    return null;
  }
}

/** অনুরোধকারীর IP (রেট লিমিটের জন্য) */
export const requestIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
