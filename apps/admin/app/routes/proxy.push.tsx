import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { pushNotifications } from "@app/tools";
import { authenticate } from "../shopify.server";
import { savePushSubscription, vapidKeys } from "../lib/push.server";
import { allowRequest } from "../lib/rate-limit.server";
import {
  activeShop,
  clientIp,
  enabledSettings,
  jsonResponse,
  readJson,
} from "../lib/tool-state.server";

/**
 * Push Notifications উইজেট (App Proxy: /apps/app-tools/push)।
 * GET: স্টোরের public চাবি (ব্রাউজার এটা দিয়ে গ্রাহক হয়)। POST: ব্রাউজারের দেওয়া ঠিকানা ও চাবি জমা।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const shop = await activeShop(session?.shop);
  if (!shop || !(await enabledSettings(shop, pushNotifications))) {
    return jsonResponse({ error: "disabled" }, 404);
  }
  return jsonResponse({ key: (await vapidKeys(shop.id)).publicKey });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const shop = await activeShop(session?.shop);
  if (!shop) return jsonResponse({ error: "unavailable" }, 404);
  if (!allowRequest(`push:${shop.id}:${clientIp(request)}`, 10, 10 * 60_000)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }
  const result = await savePushSubscription(shop, await readJson(request));
  if (result === "disabled") return jsonResponse({ error: "disabled" }, 404);
  if (result === "invalid") return jsonResponse({ error: "invalid" }, 400);
  return jsonResponse({ ok: true });
};
