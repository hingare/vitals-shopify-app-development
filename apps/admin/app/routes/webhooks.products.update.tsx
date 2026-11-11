import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { queueNewImages, type ProductImagesPayload } from "../lib/seo-alt.server";
import { queueStockCheck, type ProductPayload } from "../lib/stock-alerts.server";
import { activeShop } from "../lib/tool-state.server";

/**
 * products/update আর products/create (স্টক বদলালেও update আসে):
 * - Back in Stock: এই প্রোডাক্টের জন্য কেউ অপেক্ষায় থাকলে স্টক দেখার কাজ লাইনে পড়ে
 * - SEO Alt Tags: নতুন যোগ হওয়া ছবিতে alt লেখা (টুলে চালু থাকলে)
 * দুটোই শুধু কাজ লাইনে দেয়; Shopify-কে জিজ্ঞেস করা আর ইমেইল বানানো হয় ব্যাকগ্রাউন্ডে।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: domain, payload } = await authenticate.webhook(request);
  const shop = await activeShop(domain);
  if (!shop) return new Response();
  await queueStockCheck(shop, payload as ProductPayload).catch((error: unknown) =>
    console.warn("[back-in-stock] product webhook failed", error),
  );
  await queueNewImages(shop, payload as ProductImagesPayload).catch((error: unknown) =>
    console.warn("[seo-alt] product webhook failed", error),
  );
  return new Response();
};
