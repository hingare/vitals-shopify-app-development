import type { ComponentType } from "react";
import { StickyAtcPreview } from "./StickyAtcPreview";

/** টুল id → অ্যাডমিন প্রিভিউ কম্পোনেন্ট */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const previews: Record<string, ComponentType<{ settings: any }>> = {
  "sticky-atc": StickyAtcPreview,
};
