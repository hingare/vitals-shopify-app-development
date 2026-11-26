import type { ToolContext } from "../types";
import { track } from "../analytics";
import { placeNearCheckout } from "../product";
import { adopt } from "../early/run";
import { type NoticeSettings, buildNotice } from "../early/notice";

const TOOL_ID = "cart-notice";

/**
 * কার্ট পেজে বার্তা (Cart Drawer চালু থাকলে drawer নিজেও দেখায়)।
 * সাধারণত পাতা আঁকার আগেই বসে (early.ts); না বসলে এখানে বসে।
 */
export function mount({ config, settings }: ToolContext) {
  if (config.pageType !== "cart") return;
  const note = buildNotice(settings as unknown as NoticeSettings);
  if (!note) return;
  if (!adopt(TOOL_ID)) placeNearCheckout(TOOL_ID).appendChild(note);
  track(TOOL_ID, "view");
}
