import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { parseOrderAttribution, recordOrder } from "../lib/analytics.server";

/** পেইড অর্ডারে আমাদের কোনো টুলের ভূমিকা থাকলে (cart attribute) তার বিক্রি গোনা হয় */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const { toolIds, revenue } = parseOrderAttribution(
    payload as Parameters<typeof parseOrderAttribution>[0],
  );
  if (toolIds.length === 0) return new Response();

  const record = await db.shop.findUnique({ where: { domain: shop } });
  if (record) await recordOrder(record.id, toolIds, revenue);
  return new Response();
};
