import { root } from "./product";

/** /cart.js-এর পূর্ণ রূপ (Cart Drawer, Free Gifts, Upsell একসাথে ব্যবহার করে) */
export interface CartLine {
  key: string;
  variant_id: number;
  product_id: number;
  product_title: string;
  variant_title: string | null;
  url: string;
  image: string | null;
  quantity: number;
  /** সেন্টে */
  original_line_price: number;
  final_line_price: number;
  line_level_discount_allocations?: Array<{
    amount: number;
    discount_application: { title: string };
  }>;
  properties?: Record<string, string> | null;
}

export interface FullCart {
  items: CartLine[];
  item_count: number;
  total_price: number;
  items_subtotal_price: number;
  currency: string;
  cart_level_discount_applications?: Array<{ title: string; total_allocated_amount: number }>;
}

export async function getCart(): Promise<FullCart | null> {
  try {
    const res = await fetch(`${root()}cart.js`, { headers: { Accept: "application/json" } });
    return res.ok ? ((await res.json()) as FullCart) : null;
  } catch {
    return null;
  }
}

/** POST /cart/*.js; সফল হলে true */
export async function cartPost(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${root()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * আমাদের নিজের (ক্রেতার নয়) কার্টে যোগ, যেমন ফ্রি গিফট: URL-এ চিহ্ন থাকে, তাই
 * Cart Drawer বা আপসেল পপআপ এতে খোলে না (সময় দিয়ে নয়, তাই ক্রেতার যোগের সাথে গুলিয়ে যায় না)
 */
export const QUIET_ADD_PATH = "cart/add.js?app_quiet=1";

export function isQuietAddUrl(url: string): boolean {
  return url.includes("app_quiet=1");
}
