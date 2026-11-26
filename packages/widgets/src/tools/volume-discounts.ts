import type { ToolContext } from "../types";
import { track } from "../analytics";
import { placeAfterProductForm, readPageProduct } from "../product";
import { syncAbGroup } from "../offers";
import { adopt } from "../early/run";
import { type VolumeSettings, buildVolume, volumeOffer } from "../early/volume";

const TOOL_ID = "volume-discounts";

/** প্রোডাক্ট পেজে "বেশি কিনলে বেশি ছাড়" টেবিল; সাধারণত পাতা আঁকার আগেই বসে (early.ts) */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as VolumeSettings;
  syncAbGroup(config);
  if (config.pageType !== "product" || !s.showTable) return;
  const product = readPageProduct();
  const offer = product ? volumeOffer(config, product) : undefined;
  if (!product || !offer) return;
  if (!adopt(TOOL_ID)) {
    placeAfterProductForm(TOOL_ID).appendChild(buildVolume(offer, product, s, config));
  }
  track(TOOL_ID, "view");
}
