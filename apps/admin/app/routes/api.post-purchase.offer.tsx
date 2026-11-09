import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getPostPurchaseOffer } from "../lib/post-purchase.server";
import { purchaseSchema, shopFromDest } from "../lib/post-purchase";

/** post-purchase extension-এর ShouldRender: এই অর্ডারের জন্য কোনো আপসেল আছে কিনা */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { cors } = await authenticate.public.checkout(request);
  return cors(new Response(null, { status: 204 }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { cors, sessionToken } = await authenticate.public.checkout(request);
  const parsed = purchaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return cors(Response.json({ offer: null }, { status: 400 }));
  const offer = await getPostPurchaseOffer(shopFromDest(sessionToken.dest), {
    ...parsed.data.purchase,
    today: new Date().toISOString().slice(0, 10),
  });
  return cors(Response.json({ offer }));
};
