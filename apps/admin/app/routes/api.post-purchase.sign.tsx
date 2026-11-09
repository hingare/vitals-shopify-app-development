import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "@app/tool-sdk";
import { authenticate } from "../shopify.server";
import { signPostPurchase } from "../lib/post-purchase.server";
import { purchaseSchema, shopFromDest } from "../lib/post-purchase";

const schema = purchaseSchema.extend({
  referenceId: z.string().min(1).max(200),
  offerId: z.string().min(1).max(100),
  variantId: z.number().int().positive(),
});

/** Accept চাপলে: সার্ভার নিজে অফার থেকে পরিবর্তন বানিয়ে সই করে (ক্লায়েন্টের পাঠানো ছাড় নয়) */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { cors } = await authenticate.public.checkout(request);
  return cors(new Response(null, { status: 204 }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { cors, sessionToken } = await authenticate.public.checkout(request);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return cors(Response.json({ token: null }, { status: 400 }));
  const { referenceId, offerId, variantId, purchase } = parsed.data;
  const token = await signPostPurchase(
    shopFromDest(sessionToken.dest),
    {
      referenceId,
      offerId,
      variantId,
      purchase: { ...purchase, today: new Date().toISOString().slice(0, 10) },
    },
    { apiKey: process.env.SHOPIFY_API_KEY ?? "", secret: process.env.SHOPIFY_API_SECRET ?? "" },
  );
  return cors(Response.json({ token }, { status: token ? 200 : 409 }));
};
