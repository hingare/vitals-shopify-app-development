import { render } from "preact";
import type { StoreConfig, StoreOffers, ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { currencyRate, onCartChange } from "../cart";
import { fill } from "../dom";
import { money, placeNearCheckout } from "../product";
import { type CartLine, QUIET_ADD_PATH, cartPost, getCart } from "../cart-api";
import { offerShown, syncAbGroup } from "../offers";

const TOOL_ID = "free-gifts";
/** আমরা যোগ করা গিফট লাইন চেনার জন্য (আন্ডারস্কোর দিলে চেকআউটে দেখায় না) */
const GIFT_PROPERTY = "_app_gift";

interface Settings {
  autoAdd: boolean;
  showProgress: boolean;
  colors: { background: string; text: string; accent: string };
}

type Gift = NonNullable<StoreOffers["gifts"]>[number];

type CartItem = Pick<
  CartLine,
  | "key"
  | "variant_id"
  | "product_id"
  | "quantity"
  | "original_line_price"
  | "final_line_price"
  | "properties"
>;

const post = cartPost;

const session = {
  get(key: string) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // private mode
    }
  },
};

/** গিফট পাওয়ার শর্ত: গিফট বাদে কার্টের দাম আর কেনা প্রোডাক্ট (সেন্টে, ক্রেতার মুদ্রায়) */
export function giftStatus(gift: Gift, items: CartItem[], rate: number) {
  const others = items.filter((i) => String(i.variant_id) !== gift.variantId);
  const subtotal = others.reduce((sum, i) => sum + i.original_line_price, 0);
  const bought = others
    .filter(
      (i) =>
        gift.triggerProductIds.length === 0 ||
        gift.triggerProductIds.includes(String(i.product_id)),
    )
    .reduce((sum, i) => sum + i.quantity, 0);
  const minCents = Math.round((gift.rules?.minSubtotal ?? 0) * rate * 100);
  return {
    qualifies: bought >= Math.max(1, gift.minQty) && subtotal >= minCents,
    /** শুধু টাকার শর্ত বাকি থাকলে কত বাকি */
    remaining: bought >= Math.max(1, gift.minQty) ? Math.max(0, minCents - subtotal) : null,
  };
}

/**
 * কার্ট বদলালে:
 * - শর্ত পূরণ হলে গিফট যোগ করে, তারপর দেখে চেকআউটের ছাড়ে সত্যিই ফ্রি হয়েছে কিনা;
 *   না হলে (যেমন ক্রেতার ট্যাগ মেলেনি) সাথে সাথে সরিয়ে দেয়, তাই ক্রেতাকে কখনো গিফটের দাম দিতে হয় না
 * - শর্ত আর না মিললে আমাদের যোগ করা গিফট সরায়
 * - ক্রেতা নিজে গিফট সরালে এই সেশনে আর যোগ করে না
 */
async function reconcile(config: StoreConfig, s: Settings, gifts: Gift[], busy: { on: boolean }) {
  if (busy.on) return;
  busy.on = true;
  try {
    const cart = await getCart();
    if (!cart) return;
    const rate = currencyRate();
    let changed = false;
    let progress: { gift: Gift; remaining: number } | null = null;
    let unlocked: Gift | null = null;

    for (const gift of gifts) {
      const ours = cart.items.filter((i) => i.properties?.[GIFT_PROPERTY] === gift.id);
      const status = giftStatus(gift, cart.items, rate);
      const addedKey = `app_gift_added_${gift.id}`;
      const skipKey = `app_gift_skip_${gift.id}`;

      if (!status.qualifies) {
        if (status.remaining !== null && status.remaining > 0 && !progress) {
          progress = { gift, remaining: status.remaining };
        }
        for (const line of ours) {
          await post("cart/change.js", { id: line.key, quantity: 0 });
          changed = true;
        }
        continue;
      }

      if (ours.length > 0) {
        unlocked = unlocked ?? gift;
        continue;
      }
      // আগে যোগ করেছিলাম কিন্তু এখন নেই, অথচ শর্ত পূরণ: ক্রেতা নিজে সরিয়েছেন
      if (session.get(addedKey)) session.set(skipKey, "1");
      if (!s.autoAdd || session.get(skipKey)) continue;

      const added = await post(QUIET_ADD_PATH, {
        items: [
          {
            id: Number(gift.variantId),
            quantity: gift.qty,
            properties: { [GIFT_PROPERTY]: gift.id },
          },
        ],
      });
      if (!added) {
        session.set(skipKey, "1");
        continue;
      }
      changed = true;
      const after = await getCart();
      const line = after?.items.find((i) => i.properties?.[GIFT_PROPERTY] === gift.id);
      if (!line) continue;
      if (line.final_line_price > 0) {
        // চেকআউটের ছাড় এই ক্রেতার জন্য গিফট ফ্রি করেনি: সরিয়ে দিই, আর চেষ্টা নয়
        await post("cart/change.js", { id: line.key, quantity: 0 });
        session.set(skipKey, "1");
        continue;
      }
      session.set(addedKey, "1");
      track(TOOL_ID, "add_to_cart");
      unlocked = unlocked ?? gift;
    }

    if (s.showProgress && config.pageType === "cart") {
      showMessage(config, s, progress, unlocked);
    }
    // কার্ট পেজে থিমের দেখানো লাইন আর দাম ঠিক রাখতে রিলোড
    if (changed && config.pageType === "cart") location.reload();
  } finally {
    busy.on = false;
  }
}

let host: HTMLElement | null = null;

function showMessage(
  config: StoreConfig,
  s: Settings,
  progress: { gift: Gift; remaining: number } | null,
  unlocked: Gift | null,
) {
  const t = (key: Parameters<typeof widgetT>[1]) => widgetT(config.locale, key);
  let text = "";
  if (progress) {
    const amount = money(progress.remaining, config.currency, config.locale);
    text = progress.gift.progressText
      ? fill(progress.gift.progressText, { amount })
      : fill(t("giftProgress"), { amount, gift: progress.gift.title });
  } else if (unlocked) {
    text = fill(t("giftUnlocked"), { gift: unlocked.title });
  }
  if (!text) {
    if (host) render(null, host);
    return;
  }
  if (!host) {
    host = placeNearCheckout(TOOL_ID);
    track(TOOL_ID, "view");
  }
  render(
    <p
      role="status"
      style={{
        margin: "12px 0",
        padding: "10px 14px",
        borderRadius: "8px",
        background: s.colors.background,
        color: s.colors.text,
        border: `1px solid ${s.colors.accent}`,
        fontWeight: 600,
      }}
    >
      🎁 {text}
    </p>,
    host,
  );
}

export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  syncAbGroup(config);
  const gifts = (config.offers?.gifts ?? []).filter((g) => offerShown(g.rules, config));
  if (gifts.length === 0) return;
  const busy = { on: false };
  const run = () => void reconcile(config, s, gifts, busy);
  run();
  onCartChange(run);
}
