import { defineTool, themeColors, z } from "@app/tool-sdk";
import { text } from "./fields";

/** ছোট টুল: প্রতিটি একটা ছোট কাজ করে, পেজে প্রায় কোনো ওজন যোগ করে না */

export const scrollToTop = defineTool({
  id: "scroll-to-top",
  category: "conversion",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    position: z.enum(["bottom-right", "bottom-left"]).default("bottom-right"),
    showAfter: z.number().int().min(100).max(5000).default(600),
    showOnMobile: z.boolean().default(true),
    colors: themeColors({ background: "#111827", text: "#FFFFFF", accent: "#111827" }),
  }),
});

export const inactiveTabMessage = defineTool({
  id: "inactive-tab-message",
  category: "conversion",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    message: text(60, "Come back, we miss you!"),
    onlyWithCart: z.boolean().default(false),
  }),
});

export const contentProtection = defineTool({
  id: "content-protection",
  category: "protect",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    protectImages: z.boolean().default(true),
    disableTextSelection: z.boolean().default(false),
    disableRightClick: z.boolean().default(false),
    disableShortcuts: z.boolean().default(false),
  }),
});

export const animatedAtc = defineTool({
  id: "animated-atc",
  category: "conversion",
  plan: "starter",
  surfaces: ["product"],
  delivery: "embed",
  settings: z.object({
    animation: z.enum(["shake", "pulse", "bounce", "wobble"]).default("shake"),
    intervalSeconds: z.number().int().min(2).max(30).default(6),
  }),
  attribution: ["add_to_cart"],
});

export const SHARE_NETWORKS = ["facebook", "x", "pinterest", "whatsapp", "email", "copy"] as const;

export const socialButtons = defineTool({
  id: "social-buttons",
  category: "marketing",
  plan: "starter",
  surfaces: ["product"],
  delivery: "embed",
  settings: z.object({
    networks: z
      .array(z.enum(SHARE_NETWORKS))
      .min(1)
      .max(6)
      .default(["facebook", "x", "pinterest", "whatsapp"]),
    heading: text(60, "Share"),
    colors: themeColors({ background: "#F3F4F6", text: "#111827", accent: "#111827" }),
  }),
  attribution: ["click"],
});

export const autoExternalLinks = defineTool({
  id: "auto-external-links",
  category: "conversion",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({}),
});

export const faviconCartCount = defineTool({
  id: "favicon-cart-count",
  category: "conversion",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    colors: themeColors({ background: "#DC2626", text: "#FFFFFF", accent: "#DC2626" }),
  }),
});
