import type { ToolContext } from "../types";
import { track } from "../analytics";
import { placeAfterProductForm, placeNearCheckout } from "../product";
import { adopt } from "../early/run";
import { type LogosSettings, buildLogos, paymentIcons } from "../early/logos";

const TOOL_ID = "payment-logos";

/**
 * প্রোডাক্ট পাতায় Add to cart-এর নিচে আর কার্টে চেকআউটের কাছে লোগো early.ts পাতা আঁকার আগেই বসায়;
 * এখানে শুধু সেটা না থাকলে (পুরনো embed) বসানো, আর ফুটারে (সেটা পাতার নিচে, দেখা যাওয়ার আগে বসে)।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as LogosSettings;
  const template = paymentIcons();
  if (!template) return;
  let shown = adopt(TOOL_ID) !== null;
  if (!shown) {
    const host =
      s.showOnProduct && config.pageType === "product"
        ? placeAfterProductForm(TOOL_ID)
        : s.showOnCart && config.pageType === "cart"
          ? placeNearCheckout(TOOL_ID)
          : null;
    if (host) {
      host.appendChild(buildLogos(s, template));
      shown = true;
    }
  }
  const footer = document.querySelector("footer");
  if (s.showInFooter && footer) {
    footer.appendChild(buildLogos(s, template));
    shown = true;
  }
  if (shown) track(TOOL_ID, "view");
}
