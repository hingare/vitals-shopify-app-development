import type { ToolContext } from "../types";
import { type TabsSettings, findDescription, transform } from "../early/tabs";

/** বিবরণ ট্যাব বা accordion-এ; সাধারণত পাতা আঁকার আগেই হয়ে যায় (early.ts), না হলে এখানে */
export function mount({ config, settings }: ToolContext) {
  if (config.pageType !== "product") return;
  const el = findDescription();
  if (el) transform(el, settings as unknown as TabsSettings);
}
