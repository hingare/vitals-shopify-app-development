/** অ্যাপ যে কনফিগ লেখে (apps/admin/app/lib/offers.server.ts → buildOfferConfigs().checkout) */
export interface CheckoutUpsell {
  id: string;
  /** সংখ্যা-id; খালি = যেকোনো প্রোডাক্ট */
  triggerProductIds: string[];
  /** gid://shopify/Product/... */
  productIds: string[];
  value: { percent?: number; amountEach?: number } | null;
  title: string;
  rules: {
    startsOn?: string;
    endsOn?: string;
    abGroup?: "" | "A" | "B";
    minSubtotal?: number;
    restricted?: boolean;
  };
}

export function readOffers(raw: string | undefined): CheckoutUpsell[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { upsells?: CheckoutUpsell[] };
    return Array.isArray(parsed.upsells) ? parsed.upsells : [];
  } catch {
    return [];
  }
}

const numericId = (gid: string) => gid.split("/").pop() ?? "";

/**
 * কার্টের প্রোডাক্ট দেখে প্রথম মানানসই অফার, কার্টে আগে থেকে থাকা প্রোডাক্ট বাদ দিয়ে।
 * তারিখ আর A/B গ্রুপ এখানেই মেলানো যায়; বাকি শর্ত function নিজে দেখে।
 */
export function pickOffer(
  offers: CheckoutUpsell[],
  cartProductGids: string[],
  today: string,
  abGroup: string | undefined,
) {
  const inCart = new Set(cartProductGids);
  const inCartIds = new Set(cartProductGids.map(numericId));
  for (const offer of offers) {
    const r = offer.rules ?? {};
    if (r.startsOn && today < r.startsOn) continue;
    if (r.endsOn && today > r.endsOn) continue;
    if (r.abGroup && r.abGroup !== abGroup) continue;
    const triggered =
      offer.triggerProductIds.length === 0 ||
      offer.triggerProductIds.some((id) => inCartIds.has(id));
    if (!triggered) continue;
    const productIds = offer.productIds.filter((id) => !inCart.has(id));
    if (productIds.length > 0) return { offer, productIds };
  }
  return null;
}

/**
 * ছাড়ের পর এক পিসের দাম, শুধু যখন নিশ্চিত যে ছাড় মিলবে (ক্রেতা বা ন্যূনতম দামের শর্ত নেই,
 * আর টাকার অঙ্কের ছাড় নয়, কারণ সেটা স্টোরের মুদ্রায়)। নইলে null, তখন শুধু আসল দাম দেখাই।
 */
export function discountedPrice(offer: CheckoutUpsell, price: number): number | null {
  const percent = offer.value?.percent ?? 0;
  if (percent <= 0 || offer.rules?.restricted || (offer.rules?.minSubtotal ?? 0) > 0) return null;
  return Math.round(price * (100 - Math.min(100, percent))) / 100;
}
