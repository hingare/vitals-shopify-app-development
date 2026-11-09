import { z } from "@app/tool-sdk";

/** post-purchase extension যা পাঠায় (inputData.initialPurchase থেকে) */
export const purchaseSchema = z.object({
  purchase: z.object({
    productIds: z.array(z.string().regex(/^\d+$/)).max(250),
    total: z.number().min(0),
  }),
});

/** session token-এর dest কখনো https:// সহ আসে */
export function shopFromDest(dest: string) {
  return dest.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}
