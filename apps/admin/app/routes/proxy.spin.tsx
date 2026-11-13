import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { allowRequest } from "../lib/rate-limit.server";
import { activeShop, cleanEmail, clientIp, jsonResponse, readJson } from "../lib/tool-state.server";
import { spin } from "../lib/wheel.server";

/** Spin the Wheel: ফল এখানে (সার্ভারে) ঠিক হয়। App Proxy: /apps/app-tools/spin */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  const shop = await activeShop(session?.shop);
  if (!shop) return jsonResponse({ error: "unavailable" }, 404);
  const body = (await readJson(request)) as { email?: unknown } | null;
  const email = cleanEmail(body?.email);
  if (!email) return jsonResponse({ error: "invalid" }, 400);
  // এক জায়গা থেকে ভিন্ন ভিন্ন ইমেইল দিয়ে বারবার ঘোরানো ঠেকাতে
  if (!allowRequest(`spin-ip:${shop.id}:${clientIp(request)}`, 5, 60 * 60_000)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }
  // একই ইমেইলে একসাথে দুটো অনুরোধ এলে দ্বিতীয়টা থামে
  if (!allowRequest(`spin-email:${shop.id}:${email}`, 1, 15_000)) {
    return jsonResponse({ error: "already" }, 409);
  }
  const result = await spin(shop, admin, email);
  if (result.ok) return jsonResponse(result);
  const status = { disabled: 404, invalid: 400, already: 409, unavailable: 503 }[result.error];
  return jsonResponse({ error: result.error }, status);
};
