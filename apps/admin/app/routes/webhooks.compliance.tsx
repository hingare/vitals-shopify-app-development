import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { redactCustomer } from "../lib/privacy.server";

/**
 * GDPR বাধ্যতামূলক webhook (App Store-এর শর্ত)।
 * ক্রেতার ব্যক্তিগত তথ্য কোন কোন টেবিলে থাকে তার হিসাব app/lib/privacy.server.ts-এ।
 * - customers/redact: সেই ক্রেতার সব তথ্য মোছা হয় (গ্রাহক তালিকা, ইমেইল, অপেক্ষার অনুরোধ, wishlist,
 *   প্রত্যাহারের বিবৃতি ইত্যাদি); রিভিউ থাকে, তবে নাম-ইমেইল ছাড়া।
 * - customers/data_request: মার্চেন্ট অ্যাডমিনের Subscribers পেজ থেকে ক্রেতার ইমেইল দিয়ে সব তথ্য নামিয়ে
 *   ক্রেতাকে দেন, তাই এখানে শুধু লগ রাখি (লগে ক্রেতার কোনো তথ্য লেখা হয় না)।
 * - shop/redact (আনইনস্টলের ৪৮ ঘণ্টা পরে): স্টোরের সব ডেটা মুছে ফেলি।
 * HMAC যাচাই authenticate.webhook করে; ভুল হলে 401 দেয়।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const customer = (payload as { customer?: { id?: unknown; email?: unknown } }).customer;

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      console.info(`[gdpr] data request for a customer of ${shop}`);
      break;
    case "CUSTOMERS_REDACT": {
      const record = await db.shop.findUnique({ where: { domain: shop }, select: { id: true } });
      if (record) {
        const counts = await redactCustomer(record.id, {
          email: customer?.email,
          customerId: customer?.id,
        });
        console.info(
          `[gdpr] redacted a customer of ${shop}: ${counts.deleted} deleted, ${counts.anonymized} anonymized`,
        );
      }
      break;
    }
    case "SHOP_REDACT":
      await db.session.deleteMany({ where: { shop } });
      await db.shop.deleteMany({ where: { domain: shop } }); // সব টেবিল cascade-এ মুছে যায়
      break;
  }
  return new Response();
};
