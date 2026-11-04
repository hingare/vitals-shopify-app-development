import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { parsePixelBatch, recordPixelBatch } from "../lib/store-analytics.server";

/**
 * Web Pixel এখানে ইভেন্ট পাঠায় (sendBeacon, text/plain)।
 * পিক্সেল Shopify-র sandbox-এ চলে, তাই App Proxy নয়, সরাসরি অ্যাপের URL-এ আসে।
 * ingestKey দিয়ে স্টোর চেনা হয়; ভুল চাবি বা আনইনস্টল করা স্টোরের ইভেন্ট ফেলে দেওয়া হয়।
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const MAX_BODY = 32 * 1024;

const shopCache = new Map<string, { shopId: string | null; until: number }>();

async function shopIdForKey(key: string): Promise<string | null> {
  const hit = shopCache.get(key);
  if (hit && hit.until > Date.now()) return hit.shopId;
  const shop = await db.shop.findUnique({
    where: { ingestKey: key },
    select: { id: true, uninstalledAt: true },
  });
  const shopId = shop && !shop.uninstalledAt ? shop.id : null;
  if (shopCache.size > 10_000) shopCache.clear();
  shopCache.set(key, { shopId, until: Date.now() + 5 * 60_000 });
  return shopId;
}

export const loader = () => new Response(null, { status: 204, headers: CORS });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const text = await request.text();
  if (text.length > MAX_BODY) return new Response(null, { status: 413, headers: CORS });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400, headers: CORS });
  }
  const batch = parsePixelBatch(body);
  if (!batch) return new Response(null, { status: 204, headers: CORS });

  const shopId = await shopIdForKey(batch.key);
  if (shopId) {
    try {
      await recordPixelBatch(shopId, batch);
    } catch (error) {
      console.error("[ingest] failed", error);
    }
  }
  return new Response(null, { status: 204, headers: CORS });
};
