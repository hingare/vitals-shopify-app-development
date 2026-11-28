import type { ToolContext } from "../types";
import { track } from "../analytics";
import { placeAfterProductForm } from "../product";
import { adopt } from "../early/run";
import { type ShippingSettings, buildShipping } from "../early/shipping";

const TOOL_ID = "shipping-info";

/**
 * আনুমানিক ডেলিভারির তারিখ আর আজকের কাটঅফ পর্যন্ত বাকি সময়। প্রথমবারেরটা early.ts পাতা আঁকার আগেই
 * বসায়; এখানে প্রতি মিনিটে আবার লেখা হয় (একই বাক্স, তাই মাপ বদলায় না)।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as ShippingSettings;
  if (config.pageType !== "product") return;
  track(TOOL_ID, "view");
  const host = adopt(TOOL_ID) ?? placeAfterProductForm(TOOL_ID);
  const show = () => host.replaceChildren(buildShipping(s, config.tzOffset, config.locale));
  show();
  setInterval(show, 60_000);
}
