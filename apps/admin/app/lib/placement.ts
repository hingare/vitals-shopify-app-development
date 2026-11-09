import { z } from "@app/tool-sdk";

/**
 * থিমে উইজেট কোথায় বসবে।
 * সাধারণত কিছু করতে হয় না: উইজেট নিজেই জনপ্রিয় থিমগুলোর Add to cart ফর্ম আর চেকআউট বাটন খুঁজে নেয়।
 * অন্যরকম থিমে মার্চেন্ট (বা আমাদের সাপোর্ট) এখানে CSS selector দিয়ে জায়গা ঠিক করে দিতে পারেন।
 */
const selector = z
  .string()
  .trim()
  .max(200)
  .regex(/^[^<{};]*$/, "Use a CSS selector like .product-form")
  .default("");

export const placementSchema = z.object({
  productAnchor: selector,
  productWhere: z.enum(["after", "before"]).default("after"),
  cartAnchor: selector,
  cartWhere: z.enum(["after", "before"]).default("after"),
});

export type Placement = z.output<typeof placementSchema>;

export function readPlacement(raw: unknown): Placement {
  const parsed = placementSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : placementSchema.parse({});
}
