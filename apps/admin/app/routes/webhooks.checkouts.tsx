import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordCheckout, type CheckoutPayload } from "../lib/flows.server";
import { activeShop, retryWebhook } from "../lib/tool-state.server";

/**
 * checkouts/create ও checkouts/update: abandoned checkout ইমেইলের জন্য (flow চালু থাকলেই কেবল কিছু রাখা হয়)।
 * কাজটা ব্যর্থ হলে Shopify খবরটা পরে আবার পাঠায়: হারানো খবরটা ক্রেতার শুধরে নেওয়া ঠিকানা হতে পারত।
 * দেরিতে বা দুবার আসা খবরে ক্ষতি নেই (Shopify-র সময় মিলিয়ে দেখা হয়, ইমেইল একবারই লাইনে পড়ে)।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: domain, payload } = await authenticate.webhook(request);
  const shop = await activeShop(domain);
  if (!shop) return new Response();
  try {
    await recordCheckout(shop, payload as CheckoutPayload);
  } catch (error) {
    return retryWebhook("flows", error);
  }
  return new Response();
};
