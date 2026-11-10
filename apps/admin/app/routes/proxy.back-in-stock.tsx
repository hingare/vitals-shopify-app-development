import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { allowRequest } from "../lib/rate-limit.server";
import { requestStockAlert } from "../lib/stock-alerts.server";
import { activeShop, clientIp, jsonResponse, readJson } from "../lib/tool-state.server";

/** Back in Stock উইজেট এখানে ইমেইল জমা দেয় (App Proxy: /apps/app-tools/back-in-stock) */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const shop = await activeShop(session?.shop);
  if (!shop) return jsonResponse({ error: "unavailable" }, 404);
  if (!allowRequest(`bis:${shop.id}:${clientIp(request)}`, 10, 10 * 60_000)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }
  const body = (await readJson(request)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonResponse({ error: "invalid" }, 400);
  const result = await requestStockAlert(shop, {
    productId: body.productId,
    variantId: body.variantId,
    email: body.email,
    newsletter: body.newsletter,
  });
  if (result === "disabled") return jsonResponse({ error: "disabled" }, 404);
  if (result === "invalid") return jsonResponse({ error: "invalid" }, 400);
  if (result === "too_many") return jsonResponse({ error: "rate_limited" }, 429);
  // আগে থেকেই অপেক্ষায় থাকলেও ক্রেতাকে একই "ধন্যবাদ" দেখাই
  return jsonResponse({ ok: true });
};
