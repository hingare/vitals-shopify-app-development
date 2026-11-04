import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { tierFromSubscriptionName } from "../lib/plans";
import { syncStoreConfig } from "../lib/tools.server";

interface Payload {
  app_subscription?: { admin_graphql_api_id?: string; name?: string; status?: string };
}

/** প্ল্যান বদলালে বা বাতিল হলে স্টোরের কনফিগ সাথে সাথে আপডেট হয় (যেমন Professional টুল বন্ধ)। */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const sub = (payload as Payload).app_subscription;
  const record = await db.shop.findUnique({ where: { domain: shop } });
  if (!record || !sub) return new Response();

  let plan = record.plan;
  let subscriptionId = record.subscriptionId;
  if (sub.status === "ACTIVE") {
    plan = tierFromSubscriptionName(sub.name);
    subscriptionId = sub.admin_graphql_api_id ?? null;
  } else if (sub.admin_graphql_api_id && sub.admin_graphql_api_id === record.subscriptionId) {
    plan = null;
    subscriptionId = null;
  }

  if (plan !== record.plan || subscriptionId !== record.subscriptionId) {
    const updated = await db.shop.update({
      where: { id: record.id },
      data: { plan, subscriptionId },
    });
    if (!updated.uninstalledAt) {
      const { admin } = await unauthenticated.admin(shop);
      await syncStoreConfig(admin, {
        id: updated.id,
        plan: updated.plan === "starter" || updated.plan === "professional" ? updated.plan : null,
      });
    }
  }
  return new Response();
};
