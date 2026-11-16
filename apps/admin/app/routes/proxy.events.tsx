import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { parseEvents, recordEvents } from "../lib/analytics.server";
import { allowRequest } from "../lib/rate-limit.server";
import { proxyClientIp, readJson } from "../lib/tool-state.server";

/**
 * স্টোরফ্রন্ট উইজেট sendBeacon দিয়ে এখানে ইভেন্ট পাঠায় (App Proxy: /apps/app-tools/events)।
 * Shopify App Proxy সিগনেচার যাচাই করে, তাই অন্য কেউ ভুয়া স্টোরের নামে পাঠাতে পারে না।
 */
const MAX_BODY = 32 * 1024;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return new Response(null, { status: 204 });

  // উইজেট সাধারণত ৩ সেকেন্ডে একবার পাঠায়; একই IP থেকে মিনিটে ৬০-এর বেশি এলে বাকিগুলো ফেলে দেওয়া হয়
  if (!allowRequest(`events:${session.shop}:${proxyClientIp(request)}`, 60, 60_000)) {
    return new Response(null, { status: 429 });
  }
  const body = await readJson(request, MAX_BODY);
  if (body === null) return new Response(null, { status: 400 });
  const events = parseEvents(body);
  if (events.length === 0) return new Response(null, { status: 204 });

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (shop && !shop.uninstalledAt) await recordEvents(shop.id, events);
  return new Response(null, { status: 204 });
};
