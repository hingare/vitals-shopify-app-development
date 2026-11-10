import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { orderTracker } from "@app/tools";
import { authenticate } from "../shopify.server";
import { trackOrder } from "../lib/order-tracker.server";
import { allowRequest } from "../lib/rate-limit.server";
import {
  activeShop,
  clientIp,
  enabledSettings,
  jsonResponse,
  readJson,
} from "../lib/tool-state.server";

/**
 * Order Tracker (App Proxy: /apps/app-tools/track)।
 * GET: স্টোরের থিমের ভেতরে একটা ফাঁকা পেজ, যেখানে উইজেট ফর্মটা বসায় (মার্চেন্ট মেনুতে এই লিংক দিতে পারেন)।
 * POST: অর্ডার নম্বর আর ইমেইল/ফোন মিলিয়ে অবস্থা দেয়।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const shop = await activeShop(session?.shop);
  // টুল বন্ধ থাকলে ফাঁকা পেজ নয়: পুরোনো লিংকে এলে ক্রেতা স্পষ্ট "নেই" দেখে
  if (!shop || !(await enabledSettings(shop, orderTracker))) {
    return new Response("Not found", { status: 404 });
  }
  // application/liquid দিলে Shopify এটা স্টোরের থিমের layout-এর ভেতরে দেখায়
  return new Response('<div id="app-order-tracker-page" style="min-height:40vh"></div>', {
    headers: { "Content-Type": "application/liquid" },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  const shop = await activeShop(session?.shop);
  if (!shop || !admin || !(await enabledSettings(shop, orderTracker))) {
    return jsonResponse({ error: "disabled" }, 404);
  }
  // অর্ডার নম্বর অনুমান করে করে খোঁজা ঠেকাতে কড়া সীমা
  if (!allowRequest(`track:${shop.id}:${clientIp(request)}`, 10, 10 * 60_000)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }
  const body = (await readJson(request)) as { order?: unknown; contact?: unknown } | null;
  const order = await trackOrder(admin, { order: body?.order, contact: body?.contact }).catch(
    (error: unknown) => {
      console.warn("[order-tracker] lookup failed", error);
      return null;
    },
  );
  // নম্বর ভুল আর ইমেইল ভুল দুটোতেই একই উত্তর, যাতে কোন অর্ডার নম্বর আছে তা বোঝা না যায়
  if (!order) return jsonResponse({ error: "not_found" }, 404);
  return jsonResponse({ order });
};
