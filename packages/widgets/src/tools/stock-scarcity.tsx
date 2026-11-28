import type { ToolContext } from "../types";
import { track } from "../analytics";
import {
  currentVariantId,
  onVariantChange,
  placeAfterProductForm,
  readPageProduct,
} from "../product";
import { adopt } from "../early/run";
import { type ScarcitySettings, buildScarcity, lowStock } from "../early/scarcity";

export { lowStock };

const TOOL_ID = "stock-scarcity";

/**
 * স্টক কম থাকলে "আর মাত্র ৩টা" (ভেরিয়েন্ট বদলালে সাথে সাথে বদলায়)। প্রথমবারেরটা early.ts পাতা আঁকার
 * আগেই বসায়; এখানে একই জিনিস আবার বানিয়ে বদলে দেওয়া হয়, মাপ একই থাকে।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as ScarcitySettings;
  if (config.pageType !== "product") return;
  const product = readPageProduct();
  if (!product?.inventory || Object.keys(product.inventory).length === 0) return;
  track(TOOL_ID, "view");
  const host = adopt(TOOL_ID) ?? placeAfterProductForm(TOOL_ID);
  const show = () => {
    const qty = lowStock(product.inventory, currentVariantId(product.variantId), s.threshold);
    host.replaceChildren(...(qty === null ? [] : [buildScarcity(s, qty)]));
  };
  show();
  onVariantChange(show);
}
