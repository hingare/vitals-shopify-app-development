import { canUseTool, type AnyTool, type Plan, type ToolDefinition, type z } from "@app/tool-sdk";
import db from "../db.server";

export interface ShopRef {
  id: string;
  plan: string | null;
}

const planOf = (shop: ShopRef): Plan | null =>
  shop.plan === "starter" || shop.plan === "professional" ? shop.plan : null;

/**
 * টুল চালু আর স্টোরের প্ল্যানে অনুমোদিত হলে তার সেটিংস (ডিফল্টসহ), নইলে null।
 * সার্ভারের প্রতিটা স্টোরফ্রন্ট রাস্তা (proxy) আগে এটা দেখে, তাই বন্ধ টুল বা
 * প্ল্যানের বাইরের টুল কোনোভাবেই চালানো যায় না।
 */
export async function enabledSettings<S extends z.ZodType<Record<string, unknown>>>(
  shop: ShopRef,
  tool: ToolDefinition<S>,
): Promise<z.output<S> | null> {
  const plan = planOf(shop);
  if (!plan || !canUseTool(tool as unknown as AnyTool, plan)) return null;
  const row = await db.toolSetting.findUnique({
    where: { shopId_toolId: { shopId: shop.id, toolId: tool.id } },
  });
  if (!row?.enabled) return null;
  const parsed = tool.settings.safeParse(row.settings ?? {});
  return parsed.success ? parsed.data : tool.settings.parse({});
}

/** ইনস্টল থাকা স্টোর (আনইনস্টল হলে null) */
export async function activeShop(domain: string | undefined | null) {
  if (!domain) return null;
  const shop = await db.shop.findUnique({ where: { domain } });
  return shop && !shop.uninstalledAt ? shop : null;
}

/**
 * webhook-এর কাজ ব্যর্থ হলে এই উত্তর দেওয়া হয়। 2xx ছাড়া যেকোনো উত্তরে Shopify খবরটা পরে আবার পাঠায়
 * (৪ ঘণ্টায় ৮ বার পর্যন্ত), তাই ডাটাবেস বা Shopify-র সাময়িক সমস্যায় খবরটা হারায় না।
 * শুধু সেই webhook-এ ব্যবহার করা হয় যার কাজ দুবার চললেও ফল একই থাকে।
 */
export function retryWebhook(label: string, error: unknown) {
  console.error(`[${label}] webhook failed; Shopify will send it again`, error);
  return new Response(null, { status: 503 });
}

export const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** অনুরোধকারীর IP (রেট লিমিটের জন্য) */
export const clientIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** ইমেইল ছোট হাতের অক্ষরে; ভুল হলে null */
export function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

/** স্টোরফ্রন্ট থেকে আসা JSON body (ভুল হলে null) */
export async function readJson(request: Request, maxBytes = 16 * 1024): Promise<unknown> {
  // বড় body পুরোটা মেমরিতে তোলার আগেই থামে: আগে ঘোষিত আকার, তারপর পড়তে পড়তে গোনা
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
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
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    return null;
  }
}
