import type { ToolContext } from "../types";
import { track } from "../analytics";
import { placeAfterProductForm, placeNearCheckout } from "../product";
import { adopt } from "../early/run";
import { type SealsSettings, buildSeals, knownBadges } from "../early/seals";

const TOOL_ID = "trust-seals";

/**
 * Add to cart-এর নিচে (বা কার্টে চেকআউটের কাছে) ভরসার ব্যাজ। early.ts পাতা আঁকার আগেই বসায়; এখানে
 * শুধু সেটা না থাকলে (পুরনো embed) বসানো।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as SealsSettings;
  const badges = knownBadges(s);
  if (badges.length === 0) return;
  if (!adopt(TOOL_ID)) {
    let host: HTMLElement;
    if (config.pageType === "product") host = placeAfterProductForm(TOOL_ID);
    else if (config.pageType === "cart" && s.showOnCart) host = placeNearCheckout(TOOL_ID);
    else return;
    host.appendChild(buildSeals(s, badges, config.locale));
  }
  track(TOOL_ID, "view");
}
