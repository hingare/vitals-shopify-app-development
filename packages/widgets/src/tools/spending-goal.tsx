import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { StoreConfig, ToolContext } from "../types";
import { track } from "../analytics";
import { type Cart, currencyRate, fetchCart, onCartChange } from "../cart";
import { barHost, fill, isMobile } from "../dom";
import { money } from "../product";

const TOOL_ID = "spending-goal";

interface Settings {
  goal: number;
  messageEmpty: string;
  messageProgress: string;
  messageDone: string;
  position: "top" | "bottom";
  showOnMobile: boolean;
  colors: { background: string; text: string; accent: string };
}

function GoalBar({ s, config }: { s: Settings; config: StoreConfig }) {
  const [cart, setCart] = useState<Cart | null>(null);

  useEffect(() => {
    const load = () => void fetchCart().then(setCart);
    load();
    onCartChange(load);
  }, []);

  if (!cart) return null;
  const goal = Math.round(s.goal * 100 * currencyRate());
  const format = (cents: number) => money(cents, cart.currency || config.currency, config.locale);
  const left = goal - cart.total_price;
  const message =
    cart.item_count === 0
      ? fill(s.messageEmpty, { goal: format(goal) })
      : left > 0
        ? fill(s.messageProgress, { amount: format(left), goal: format(goal) })
        : s.messageDone;
  const percent = Math.min(100, (cart.total_price / goal) * 100);

  return (
    <div
      role="status"
      style={{
        background: s.colors.background,
        color: s.colors.text,
        padding: "8px 16px",
        textAlign: "center",
        fontSize: "14px",
      }}
    >
      <div>{message}</div>
      {cart.item_count > 0 && (
        <div
          aria-hidden="true"
          style={{
            maxWidth: "360px",
            height: "6px",
            margin: "6px auto 0",
            borderRadius: "3px",
            background: "rgba(0,0,0,.1)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              background: s.colors.accent,
              transition: "width .4s",
            }}
          />
        </div>
      )}
    </div>
  );
}

/** ফ্রি শিপিং বা পুরস্কারের জন্য আর কত কিনতে হবে */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (!s.showOnMobile && isMobile()) return;
  track(TOOL_ID, "view");
  render(<GoalBar s={s} config={config} />, barHost(s.position, TOOL_ID));
}
