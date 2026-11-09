import { render } from "preact";
import type { ToolContext } from "../types";
import { track } from "../analytics";
import { placeNearCheckout } from "../product";
import { Notice, type NoticeSettings } from "../notice";

const TOOL_ID = "cart-notice";

/** কার্ট পেজে বার্তা (Cart Drawer চালু থাকলে drawer নিজেও দেখায়) */
export function mount({ config, settings }: ToolContext) {
  if (config.pageType !== "cart") return;
  track(TOOL_ID, "view");
  render(<Notice s={settings as unknown as NoticeSettings} />, placeNearCheckout(TOOL_ID));
}
