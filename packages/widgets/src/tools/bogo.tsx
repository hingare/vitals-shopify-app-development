import type { ToolContext } from "../types";
import { track } from "../analytics";
import { placeAfterProductForm, readPageProduct } from "../product";
import { syncAbGroup } from "../offers";
import { adopt } from "../early/run";
import { type BogoSettings, bogoOffer, bogoText, buildBogo } from "../early/bogo";

export { bogoText };

const TOOL_ID = "bogo";

/**
 * প্রোডাক্ট পেজে এই প্রোডাক্টের BOGO অফার জানানো। লেখাটা early.ts পাতা আঁকার আগেই বসায়; এখানে শুধু
 * সেটা না থাকলে (পুরনো embed) বসানো। A/B দল মেলানো সব পাতায় (কার্টে ছাড় সেই দল দেখে হয়)।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as BogoSettings;
  syncAbGroup(config);
  if (config.pageType !== "product" || !s.showBadge) return;
  const product = readPageProduct();
  if (!product) return;
  const offer = bogoOffer(config, product);
  if (!offer) return;
  if (!adopt(TOOL_ID)) placeAfterProductForm(TOOL_ID).appendChild(buildBogo(s, offer, config));
  track(TOOL_ID, "view");
}
