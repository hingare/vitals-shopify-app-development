import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { queueNewImages, type ProductImagesPayload } from "../lib/seo-alt.server";
import { queueNewMeta } from "../lib/seo-meta.server";
import { queueStockCheck, type ProductPayload } from "../lib/stock-alerts.server";
import { activeShop, retryWebhook } from "../lib/tool-state.server";

/**
 * products/update আর products/create (স্টক বদলালেও update আসে):
 * - Back in Stock: এই প্রোডাক্টের জন্য কেউ অপেক্ষায় থাকলে স্টক দেখার কাজ লাইনে পড়ে
 * - SEO Alt Tags: নতুন যোগ হওয়া ছবিতে alt লেখা (টুলে চালু থাকলে)
 * - SEO Meta Templates: নতুন বা বদলানো প্রোডাক্টের ফাঁকা SEO টাইটেল ও বর্ণনা (টুলে চালু থাকলে)
 * সবগুলো শুধু কাজ লাইনে দেয়; Shopify-কে জিজ্ঞেস করা আর ইমেইল বানানো হয় ব্যাকগ্রাউন্ডে।
 * একটা ব্যর্থ হলেও বাকিগুলো চলে; কোনোটা ব্যর্থ হলে Shopify খবরটা পরে আবার পাঠায় (স্টকে ফেরার খবরটা হারালে
 * অপেক্ষায় থাকা ক্রেতারা ইমেইল পেতেন না)। দুবার চললে একই কাজ দুবার লাইনে পড়ে না।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: domain, payload } = await authenticate.webhook(request);
  const shop = await activeShop(domain);
  if (!shop) return new Response();
  const results = await Promise.allSettled([
    queueStockCheck(shop, payload as ProductPayload),
    queueNewImages(shop, payload as ProductImagesPayload),
    queueNewMeta(shop),
  ]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) return retryWebhook("products", failed.reason);
  return new Response();
};
