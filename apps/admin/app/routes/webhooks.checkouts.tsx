import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordCheckout, type CheckoutPayload } from "../lib/flows.server";
import { activeShop } from "../lib/tool-state.server";

/** checkouts/create ও checkouts/update: abandoned checkout ইমেইলের জন্য (flow চালু থাকলেই কেবল কিছু রাখা হয়) */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: domain, payload } = await authenticate.webhook(request);
  const shop = await activeShop(domain);
  if (!shop) return new Response();
  await recordCheckout(shop, payload as CheckoutPayload).catch((error: unknown) =>
    console.warn("[flows] checkout webhook failed", error),
  );
  return new Response();
};
