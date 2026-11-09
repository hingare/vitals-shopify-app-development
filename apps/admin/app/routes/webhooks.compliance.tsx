import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { redactCustomerReviews } from "../lib/reviews.server";

/**
 * GDPR বাধ্যতামূলক webhook (App Store-এর শর্ত)।
 * ক্রেতার ব্যক্তিগত তথ্য আমরা শুধু রিভিউতে রাখি (নাম ও ইমেইল)।
 * customers/redact এলে সেই ক্রেতার রিভিউ বেনামী করি।
 * customers/data_request: মার্চেন্ট অ্যাডমিনের Reviews পেজে ইমেইল দিয়ে খুঁজে ডেটা দিতে পারেন, তাই শুধু লগ রাখি।
 * shop/redact এলে (আনইনস্টলের ৪৮ ঘণ্টা পরে) স্টোরের সব ডেটা মুছে ফেলি।
 * HMAC যাচাই authenticate.webhook করে; ভুল হলে 401 দেয়।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const customer = (payload as { customer?: { email?: string } }).customer;

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      console.info(`[gdpr] data request for a customer of ${shop}`);
      break;
    case "CUSTOMERS_REDACT":
      await redactCustomerReviews(shop, customer?.email);
      break;
    case "SHOP_REDACT":
      await db.session.deleteMany({ where: { shop } });
      await db.shop.deleteMany({ where: { domain: shop } }); // সব টেবিল cascade-এ মুছে যায়
      break;
  }
  return new Response();
};
