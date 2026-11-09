import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enabledReviewSettings } from "../lib/reviews.server";
import { allowRequest } from "../lib/rate-limit.server";
import { createUploadTargets, parseUploadRequest } from "../lib/review-media.server";

/**
 * রিভিউর ছবি আপলোডের অনুমতি (App Proxy: /apps/app-tools/reviews/uploads)।
 * ব্রাউজার এখান থেকে Shopify-র স্টোরেজের ঠিকানা পেয়ে সেখানে সরাসরি ছবি পাঠায়।
 */
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) return json({ error: "unavailable" }, 404);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop || shop.uninstalledAt) return json({ error: "unavailable" }, 404);
  const settings = await enabledReviewSettings(shop.id);
  if (!settings?.showForm || !settings.allowPhotos) return json({ error: "disabled" }, 404);

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!allowRequest(`review-upload:${shop.id}:${ip}`, 10, 10 * 60 * 1000)) {
    return json({ error: "rate_limited" }, 429);
  }

  let body: unknown = null;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "invalid" }, 400);
  }
  const files = parseUploadRequest(body);
  if (!files) return json({ error: "invalid" }, 400);
  try {
    return json({ targets: await createUploadTargets(admin, files) });
  } catch (error) {
    console.warn("[reviews] staged upload failed", error);
    return json({ error: "upload_failed" }, 502);
  }
};
