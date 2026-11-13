import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { parseOrderAttribution, recordOrder } from "../lib/analytics.server";
import { recentSalesEnabled, recordSales } from "../lib/recent-sales.server";
import { recordOfferOrder } from "../lib/offer-stats.server";
import { onOrderPaid, type OrderPayload } from "../lib/flows.server";

/**
 * পেইড অর্ডার:
 * - আমাদের কোনো টুলের ভূমিকা থাকলে (cart attribute) তার বিক্রি গোনা হয়
 * - আমাদের অফারের ছাড় থাকলে অফার রিপোর্টে আর A/B টেস্টে গোনা হয়
 * - Recent Sales চালু থাকলে প্রোডাক্ট আর সময় রাখা হয় (ক্রেতার কোনো তথ্য নয়)
 * - Review request ইমেইল চালু থাকলে সেটা লাইনে পড়ে (মার্চেন্টের ঠিক করা দিন পরে যায়)
 *
 * payload-এ শুধু shopify.app.toml-এর include_fields-এ লেখা ঘরগুলো আসে (ঠিকানা, ফোন ইত্যাদি আসে না);
 * এখানে নতুন কোনো ঘর পড়তে হলে আগে সেখানে যোগ করতে হবে।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  const record = await db.shop.findUnique({ where: { domain: shop } });
  if (!record) return new Response();

  const { toolIds, revenue } = parseOrderAttribution(
    payload as Parameters<typeof parseOrderAttribution>[0],
  );
  if (toolIds.length > 0) await recordOrder(record.id, toolIds, revenue);

  await recordOfferOrder(record.id, payload as Parameters<typeof recordOfferOrder>[1]).catch(
    (error: unknown) => console.warn("[offers] stats failed", error),
  );

  if (admin && (await recentSalesEnabled(record.id))) {
    await recordSales(admin, record.id, payload as Parameters<typeof recordSales>[2]).catch(
      (error: unknown) => console.warn("[recent-sales] record failed", error),
    );
  }
  if (admin && !record.uninstalledAt) {
    await onOrderPaid(record, admin, payload as OrderPayload).catch((error: unknown) =>
      console.warn("[flows] review request failed", error),
    );
  }
  return new Response();
};
