import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR বাধ্যতামূলক webhook (App Store-এর শর্ত)।
 * আমরা কোনো ক্রেতার ব্যক্তিগত তথ্য রাখি না, তাই customers/* এ শুধু 200 দিই।
 * shop/redact এলে (আনইনস্টলের ৪৮ ঘণ্টা পরে) স্টোরের সব ডেটা মুছে ফেলি।
 * HMAC যাচাই authenticate.webhook করে; ভুল হলে 401 দেয়।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      break;
    case "SHOP_REDACT":
      await db.session.deleteMany({ where: { shop } });
      await db.shop.deleteMany({ where: { domain: shop } }); // ToolSetting, SpeedSnapshot cascade
      break;
  }
  return new Response();
};
