import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  applyConsentChange,
  parseCustomerPayload,
  type CustomerPayload,
} from "../lib/subscribers.server";
import { activeShop } from "../lib/tool-state.server";

/**
 * customers/create, customers/update আর customers_email_marketing_consent/update।
 * Shopify-তে কেউ মার্কেটিং ইমেইলে রাজি হলে বা আনসাবস্ক্রাইব করলে আমাদের গ্রাহক তালিকাও সাথে সাথে বদলায়
 * (থিমের নিউজলেটার ফর্ম, চেকআউটের টিক, Klaviyo-র মতো অন্য অ্যাপ সবই Shopify-তে লেখে)।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: domain, payload } = await authenticate.webhook(request);
  const shop = await activeShop(domain);
  if (!shop) return new Response();
  const change = parseCustomerPayload(payload as CustomerPayload);
  if (change) {
    await applyConsentChange(shop, change).catch((error: unknown) =>
      console.warn("[subscribers] consent webhook failed", error),
    );
  }
  return new Response();
};
