/** কার্টের তথ্য আর কার্ট বদলানোর খবর (কয়েকটা টুল একসাথে ব্যবহার করে) */
export interface Cart {
  /** সেন্টে, ক্রেতার মুদ্রায় */
  total_price: number;
  item_count: number;
  currency: string;
}

export async function fetchCart(): Promise<Cart | null> {
  try {
    const res = await fetch("/cart.js", { headers: { Accept: "application/json" } });
    return res.ok ? ((await res.json()) as Cart) : null;
  } catch {
    return null;
  }
}

const CART_CHANGE = /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/;

/**
 * থিম বা অন্য অ্যাপ কার্ট বদলালে ডাকে।
 * fetch-কে মোড়ানোর বদলে ব্রাউজারের PerformanceObserver দেখে, তাই থিমের কোডে হাত পড়ে না।
 */
export function onCartChange(callback: () => void) {
  if (typeof PerformanceObserver === "undefined") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => CART_CHANGE.test(new URL(entry.name).pathname))) {
        clearTimeout(timer);
        timer = setTimeout(callback, 80);
      }
    }).observe({ type: "resource" });
  } catch {
    // পুরনো ব্রাউজার: পেজ রিলোডে আপডেট হবে
  }
}

/** স্টোরের মূল মুদ্রা থেকে ক্রেতার মুদ্রায় রূপান্তরের হার (Shopify Markets) */
export function currencyRate(): number {
  const rate = Number(window.Shopify?.currency?.rate);
  return rate > 0 ? rate : 1;
}
