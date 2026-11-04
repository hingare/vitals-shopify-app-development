import { defineTool, themeColors, z } from "@app/tool-sdk";

export const stickyAtc = defineTool({
  id: "sticky-atc",
  category: "conversion",
  plan: "starter",
  surfaces: ["product"],
  delivery: "embed",
  settings: z.object({
    position: z.enum(["bottom", "top"]).default("bottom"),
    showOnMobile: z.boolean().default(true),
    colors: themeColors(),
  }),
  attribution: ["click", "add_to_cart"],
});
