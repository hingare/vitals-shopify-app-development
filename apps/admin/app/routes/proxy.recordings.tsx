import type { ActionFunctionArgs } from "react-router";
import { visitorRecordings } from "@app/tools";
import { authenticate } from "../shopify.server";
import { allowRequest } from "../lib/rate-limit.server";
import { canRecord, hashRecordingKey, ingestChunk } from "../lib/recordings.server";
import {
  activeShop,
  clientIp,
  enabledSettings,
  jsonResponse,
  readJson,
} from "../lib/tool-state.server";

/** gzip করা এক অংশ (≤৫১২KB) base64-এ আর বাকি ঘর মিলিয়ে */
const MAX_BODY = 1024 * 1024;

/**
 * Visitor Recordings-এর রেকর্ডার এখানে কথা বলে (App Proxy: /apps/app-tools/recordings)।
 * - { action: "start" }: এই ভিজিট রেকর্ড করা যাবে কিনা (স্টোরেজ আছে আর মাসিক সীমা বাকি)
 * - { action: "chunk", key, seq, data | events, page, device }: রেকর্ডের এক অংশ
 * থামতে হলে উত্তরে `stop` থাকে ("cap": মাসের সীমা শেষ, "full": রেকর্ডিং খুব বড়, "limit": এই জায়গা থেকে
 * অনেক নতুন রেকর্ডিং, "storage": স্টোরেজ নেই, "disabled": টুল বন্ধ)।
 * লগইন করা ক্রেতার id Shopify নিজে সই করা অনুরোধে দেয় (logged_in_customer_id), শুধু তথ্য মোছার অনুরোধের জন্য।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const body = (await readJson(request, MAX_BODY)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonResponse({ error: "invalid" }, 400);
  const { session } = await authenticate.public.appProxy(request);
  const shop = await activeShop(session?.shop);
  const settings = shop ? await enabledSettings(shop, visitorRecordings) : null;
  if (!shop || !settings) return jsonResponse({ error: "disabled", stop: "disabled" }, 404);
  const ip = clientIp(request);

  if (body.action === "start") {
    if (!allowRequest(`rec-start:${shop.id}:${ip}`, 30, 60_000)) {
      return jsonResponse({ error: "rate_limited" }, 429);
    }
    return jsonResponse({ ok: await canRecord(shop) });
  }
  if (body.action !== "chunk") return jsonResponse({ error: "invalid" }, 400);

  const keyHash = hashRecordingKey(body.key);
  if (!keyHash) return jsonResponse({ error: "invalid" }, 400);
  const allowed =
    allowRequest(`rec-chunk:${shop.id}:${keyHash}`, 40, 60_000) &&
    allowRequest(`rec-chunk-ip:${shop.id}:${ip}`, 200, 60_000);
  if (!allowed) return jsonResponse({ error: "rate_limited" }, 429);

  const result = await ingestChunk(
    shop,
    {
      key: body.key,
      seq: body.seq,
      data: body.data,
      events: body.events,
      page: body.page,
      device: body.device,
      customerId: new URL(request.url).searchParams.get("logged_in_customer_id"),
    },
    {
      // একই জায়গা থেকে ঘণ্টায় অল্প কয়টার বেশি নতুন রেকর্ডিং নয় (কেউ ইচ্ছা করে মাসের সীমা ফুরাতে না পারে)
      mayCreate: () => allowRequest(`rec-new:${shop.id}:${ip}`, 20, 60 * 60_000),
    },
  );
  if (result.ok) return jsonResponse({ ok: true });
  if (result.error === "invalid") return jsonResponse({ error: "invalid" }, 422);
  return jsonResponse({ error: result.error, stop: result.error });
};
