import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  createReview,
  enabledReviewSettings,
  parseReviewInput,
  publishedReviews,
  syncProductRating,
} from "../lib/reviews.server";
import { allowRequest } from "../lib/rate-limit.server";
import { attachMedia } from "../lib/review-media.server";

/**
 * স্টোরফ্রন্টের রিভিউ উইজেট এখানে কথা বলে (App Proxy: /apps/app-tools/reviews)।
 * GET: প্রকাশিত রিভিউ আর রেটিং সারাংশ (product=<id> বা product=store)। POST: নতুন রিভিউ জমা।
 * Shopify প্রক্সি সিগনেচার যাচাই করে, তাই স্টোর চেনা নিরাপদ।
 */
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function shopFor(domain: string | undefined) {
  if (!domain) return null;
  const shop = await db.shop.findUnique({ where: { domain } });
  return shop && !shop.uninstalledAt ? shop : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  const shop = await shopFor(session?.shop);
  if (!shop) return json({ error: "unavailable" }, 404);
  const settings = await enabledReviewSettings(shop.id);
  if (!settings) return json({ error: "disabled" }, 404);

  const url = new URL(request.url);
  const product = url.searchParams.get("product") ?? "";
  if (!/^(\d{1,20}|store)$/.test(product)) return json({ error: "invalid" }, 400);
  const page = Number(url.searchParams.get("page")) || 1;
  const productId = product === "store" ? null : product;
  return json(await publishedReviews(shop.id, productId, page, settings.perPage, admin));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  const shop = await shopFor(session?.shop);
  if (!shop) return json({ error: "unavailable" }, 404);
  const settings = await enabledReviewSettings(shop.id);
  if (!settings?.showForm) return json({ error: "disabled" }, 404);

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!allowRequest(`review:${shop.id}:${ip}`, 5, 10 * 60 * 1000)) {
    return json({ error: "rate_limited" }, 429);
  }

  let body: unknown = null;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "invalid" }, 400);
  }
  const parsed = parseReviewInput(body);
  // বটকে সফল দেখাই, যাতে সে আবার চেষ্টা না করে
  if (!parsed.ok && parsed.error === "spam") return json({ status: "pending" });
  if (!parsed.ok) return json({ error: "invalid" }, 400);

  const result = await createReview(shop.id, parsed.input, settings);
  if (result.duplicate) return json({ error: "duplicate" }, 409);
  if (admin && parsed.input.media.length > 0) {
    await attachMedia(
      admin,
      result.review.id,
      parsed.input.media,
      `Review by ${parsed.input.name}`,
    ).catch((error) => console.warn("[reviews] photo attach failed", error));
  }
  const productId = parsed.input.productId;
  if (result.review.status === "published" && admin && productId) {
    await syncProductRating(admin, shop.id, productId).catch((error) =>
      console.warn("[reviews] rating sync failed", error),
    );
  }
  return json({ status: result.review.status });
};
