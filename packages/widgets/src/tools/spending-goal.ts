import type { ToolContext } from "../types";
import { track } from "../analytics";
import { type Cart, fetchCart, onCartChange } from "../cart";
import { barHost, isMobile } from "../dom";
import { adopt } from "../early/run";
import { type GoalSettings, buildGoal, showGoal } from "../early/bars";

const TOOL_ID = "spending-goal";

/**
 * ফ্রি শিপিং বা পুরস্কারের জন্য আর কত কিনতে হবে। উপরের বার পাতা আঁকার আগেই বসে (early.ts, পাতা
 * লেখার সময়ের কার্ট দিয়ে); এখানে কার্ট বদলালে লেখা আর দাগ বদলায়।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as GoalSettings;
  if (!s.showOnMobile && isMobile()) return;
  let box = (adopt(TOOL_ID)?.firstElementChild as HTMLElement | null) ?? null;
  const show = (cart: Cart | null) => {
    if (!cart) return;
    if (!box) {
      box = buildGoal(s);
      barHost(s.position, TOOL_ID).appendChild(box);
    }
    showGoal(
      box,
      s,
      { total: cart.total_price, count: cart.item_count },
      cart.currency || config.currency,
      config.locale,
    );
  };
  const load = () => void fetchCart().then(show);
  load();
  onCartChange(load);
  track(TOOL_ID, "view");
}
