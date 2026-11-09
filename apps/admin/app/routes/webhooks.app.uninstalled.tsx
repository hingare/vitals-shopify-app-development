import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * আনইনস্টল: Shopify নিজেই সাথে সাথে সব app subscription বাতিল করে, তাই আর কোনো বিল হয় না।
 * আমরা session মুছে দিই, প্ল্যান খালি করি। বাকি ডেটা shop/redact webhook-এ (৪৮ ঘণ্টা পরে) মোছা হয়।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // webhook একাধিকবার আসতে পারে, তাই সব কাজ idempotent
  await db.session.deleteMany({ where: { shop } });
  await db.shop.updateMany({
    where: { domain: shop },
    data: { uninstalledAt: new Date(), plan: null, subscriptionId: null },
  });

  return new Response();
};
