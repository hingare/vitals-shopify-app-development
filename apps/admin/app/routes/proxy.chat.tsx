import type { ActionFunctionArgs } from "react-router";
import { liveChat } from "@app/tools";
import { authenticate } from "../shopify.server";
import { allowRequest } from "../lib/rate-limit.server";
import {
  activeShop,
  clientIp,
  enabledSettings,
  jsonResponse,
  readJson,
} from "../lib/tool-state.server";
import { hashKey, hasConversation, visitorSend, visitorThread } from "../lib/chat.server";

/**
 * Live Chat উইজেট এখানে কথা বলে (App Proxy: /apps/app-tools/chat)। সব অনুরোধ POST, কারণ ক্রেতার গোপন
 * চাবি URL-এ গেলে লগে থেকে যেতে পারে।
 * - { action: "read", key?, since?, open? }: মার্চেন্ট অনলাইন কিনা আর বার্তাগুলো
 * - { action: "send", key, text, email?, page?, locale? }: নতুন বার্তা
 * লগইন করা ক্রেতার id Shopify নিজে সই করা অনুরোধে দেয় (logged_in_customer_id), ব্রাউজার সেটা বানাতে পারে না।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const body = (await readJson(request)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonResponse({ error: "invalid" }, 400);
  const { session } = await authenticate.public.appProxy(request);
  const shop = await activeShop(session?.shop);
  const settings = shop ? await enabledSettings(shop, liveChat) : null;
  if (!shop || !settings) return jsonResponse({ error: "disabled" }, 404);
  const ip = clientIp(request);
  const visitorKey = hashKey(body.key);

  if (body.action === "send") {
    if (!visitorKey) return jsonResponse({ error: "invalid" }, 400);
    const allowed =
      allowRequest(`chat-send:${shop.id}:${visitorKey}`, 8, 60_000) &&
      allowRequest(`chat-send-ip:${shop.id}:${ip}`, 30, 60_000) &&
      // একই জায়গা থেকে ঘণ্টায় কয়েকটার বেশি নতুন কথোপকথন নয়
      ((await hasConversation(shop.id, visitorKey)) ||
        allowRequest(`chat-new:${shop.id}:${ip}`, 5, 60 * 60_000));
    if (!allowed) return jsonResponse({ error: "rate_limited" }, 429);
    const result = await visitorSend(shop, settings, {
      visitorKey,
      text: body.text,
      email: body.email,
      page: body.page,
      locale: body.locale,
      customerId: new URL(request.url).searchParams.get("logged_in_customer_id"),
    });
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.error === "full" ? 409 : 422);
    }
    return jsonResponse(result);
  }

  if (!allowRequest(`chat-read:${shop.id}:${ip}`, 120, 60_000)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }
  const since = typeof body.since === "string" ? new Date(body.since) : null;
  return jsonResponse(
    await visitorThread(shop, visitorKey, {
      since: since && !Number.isNaN(since.getTime()) ? since : null,
      open: body.open === true,
    }),
  );
};
