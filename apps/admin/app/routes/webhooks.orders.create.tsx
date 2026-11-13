import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { onOrderCreated, type OrderPayload } from "../lib/flows.server";
import { activeShop, retryWebhook } from "../lib/tool-state.server";

/**
 * orders/create (টাকা পরে দেওয়া হবে এমন অর্ডারও, যেগুলো তখনো "paid" নয়; orders/paid তাদের জন্য দেরিতে আসে):
 * - চেকআউট সম্পূর্ণ বলে চিহ্ন পড়ে, তাই abandoned checkout ইমেইল আর যায় না
 * - গ্রাহকের শেষ অর্ডারের সময় রাখা হয় (win-back ইমেইলের জন্য)
 * payload-এ শুধু id, email আর checkout_token আসে (shopify.app.toml-এর include_fields)।
 * কাজটা ব্যর্থ হলে Shopify খবরটা পরে আবার পাঠায় (নইলে অর্ডার করা ক্রেতাও abandoned checkout ইমেইল পেতেন);
 * দুবার চললেও ফল একই।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: domain, payload } = await authenticate.webhook(request);
  const shop = await activeShop(domain);
  if (!shop) return new Response();
  try {
    await onOrderCreated(shop.id, payload as OrderPayload);
  } catch (error) {
    return retryWebhook("flows", error);
  }
  return new Response();
};
