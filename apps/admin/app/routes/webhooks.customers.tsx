import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  applyCustomerEvent,
  parseCustomerPayload,
  type CustomerPayload,
} from "../lib/subscribers.server";
import { activeShop } from "../lib/tool-state.server";

/**
 * customers_email_marketing_consent/update আর customers/create।
 * Shopify-তে কেউ মার্কেটিং ইমেইলে রাজি হলে বা আনসাবস্ক্রাইব করলে আমাদের গ্রাহক তালিকাও সাথে সাথে বদলায়
 * (থিমের নিউজলেটার ফর্ম, চেকআউটের টিক, Klaviyo-র মতো অন্য অ্যাপ সবই Shopify-তে লেখে)।
 *
 * সম্মতি আসে শুধু প্রথম খবরটায়: 2025-01 থেকে Shopify customer-এর payload থেকে সম্মতি আর ট্যাগ সরিয়ে নিয়েছে।
 * তাই নতুন customer-এর খবরে (যেমন নিউজলেটার ফর্ম থেকে তৈরি হওয়া) সম্মতি জানতে Shopify-কে জিজ্ঞেস করতে হয়;
 * সেই কাজে `admin` লাগে।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: domain, payload, admin } = await authenticate.webhook(request);
  const shop = await activeShop(domain);
  if (!shop) return new Response();
  const event = parseCustomerPayload(payload as CustomerPayload);
  if (event) {
    await applyCustomerEvent(shop, event, admin).catch((error: unknown) =>
      console.warn("[subscribers] customer webhook failed", error),
    );
  }
  return new Response();
};
