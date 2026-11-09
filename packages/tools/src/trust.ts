import { defineTool, themeColors, z } from "@app/tool-sdk";
import { text } from "./fields";

export const TRUST_BADGES = [
  "secure-checkout",
  "free-shipping",
  "money-back",
  "easy-returns",
  "support",
  "quality",
] as const;

/** Add to cart-এর নিচে ভরসা দেওয়ার ব্যাজ (নিরাপদ চেকআউট, ফ্রি শিপিং...) */
export const trustSeals = defineTool({
  id: "trust-seals",
  category: "trust",
  plan: "starter",
  surfaces: ["product", "cart"],
  delivery: "embed",
  settings: z.object({
    badges: z
      .array(z.enum(TRUST_BADGES))
      .min(1)
      .max(6)
      .default(["secure-checkout", "free-shipping", "money-back", "easy-returns"]),
    heading: text(80),
    iconSize: z.number().int().min(20).max(64).default(32),
    showOnCart: z.boolean().default(false),
    colors: themeColors({ background: "#FFFFFF", text: "#111827", accent: "#111827" }),
  }),
});

/**
 * পেমেন্ট লোগো। লোগো আসে Shopify থেকে (স্টোরে যে পেমেন্ট চালু আছে), তাই মার্চেন্টকে কিছু বাছতে হয় না
 * আর পেমেন্ট বদলালে লোগোও নিজে থেকে বদলায়।
 */
export const paymentLogos = defineTool({
  id: "payment-logos",
  category: "trust",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    heading: text(80, "Secure payment with"),
    showOnProduct: z.boolean().default(true),
    showOnCart: z.boolean().default(true),
    showInFooter: z.boolean().default(false),
    iconSize: z.number().int().min(20).max(64).default(32),
    grayscale: z.boolean().default(false),
  }),
});
