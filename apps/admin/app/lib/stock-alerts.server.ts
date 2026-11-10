import { backInStock } from "@app/tools";
import db from "../db.server";
import { storeUrl } from "./flows.server";
import { queueEvent } from "./integrations.server";
import { enqueueEmail } from "./messages.server";
import { subscribe } from "./subscribers.server";
import { cleanEmail, enabledSettings, type ShopRef } from "./tool-state.server";

/**
 * Back in Stock: ক্রেতা স্টক-শেষ ভ্যারিয়েন্টের জন্য ইমেইল রেখে যান; Shopify থেকে products/update এলে
 * আমরা দেখি সেই ভ্যারিয়েন্ট আবার কেনা যাচ্ছে কিনা, আর গেলে অপেক্ষায় থাকা সবাইকে একবার করে ইমেইল যায়।
 * এই ইমেইল ক্রেতার নিজের চাওয়া (মার্কেটিং নয়), তাই নিউজলেটারে রাজি না হলেও যায়।
 */
type ShopRow = ShopRef & { domain: string };

const ID = /^\d{1,20}$/;
/** একটা ঠিকানা থেকে একসাথে এর বেশি অপেক্ষার অনুরোধ নয় (অপব্যবহার ঠেকাতে) */
const MAX_WAITING_PER_EMAIL = 50;
const PAGE = 500;

export type AlertResult = "saved" | "exists" | "invalid" | "disabled" | "too_many";

export async function requestStockAlert(
  shop: ShopRow,
  input: { productId: unknown; variantId: unknown; email: unknown; newsletter?: unknown },
  now = new Date(),
): Promise<AlertResult> {
  const settings = await enabledSettings(shop, backInStock);
  if (!settings) return "disabled";
  const email = cleanEmail(input.email);
  const productId = String(input.productId ?? "");
  const variantId = String(input.variantId ?? "");
  if (!email || !ID.test(productId) || !ID.test(variantId)) return "invalid";

  const key = { shopId_variantId_email: { shopId: shop.id, variantId, email } };
  const existing = await db.stockAlert.findUnique({ where: key });
  if (existing?.status === "waiting") return "exists";
  if (existing) {
    // আগে একবার জানানো হয়েছে, আবার স্টক শেষ: নতুন অনুরোধ হিসেবে ধরি
    await db.stockAlert.update({
      where: key,
      data: { status: "waiting", notifiedAt: null, createdAt: now, productId },
    });
  } else {
    const waiting = await db.stockAlert.count({
      where: { shopId: shop.id, email, status: "waiting" },
    });
    if (waiting >= MAX_WAITING_PER_EMAIL) return "too_many";
    const { count } = await db.stockAlert.createMany({
      data: [{ shopId: shop.id, productId, variantId, email, createdAt: now }],
      skipDuplicates: true,
    });
    if (count === 0) return "exists";
  }

  if (settings.offerNewsletter && input.newsletter === true) {
    await subscribe(shop, { email, source: "back-in-stock" });
  }
  await queueEvent(shop.id, "back-in-stock", {
    email,
    name: "Back in stock requested",
    properties: { productId, variantId },
  });
  return "saved";
}

export interface ProductPayload {
  id?: number | string;
  title?: string;
  handle?: string;
  status?: string;
  variants?: Array<{
    id?: number | string;
    title?: string;
    inventory_quantity?: number | null;
    inventory_policy?: string | null;
    inventory_management?: string | null;
  }>;
}

/** এখন কেনা যায় এমন ভ্যারিয়েন্ট: স্টক আছে, স্টক গোনা হয় না, বা স্টক ছাড়াও বিক্রি চালু */
export function purchasableVariants(payload: ProductPayload): Map<string, string> {
  const out = new Map<string, string>();
  if (payload.status && payload.status !== "active") return out;
  for (const variant of payload.variants ?? []) {
    if (variant.id === undefined || variant.id === null) continue;
    const available =
      variant.inventory_management !== "shopify" ||
      variant.inventory_policy === "continue" ||
      (variant.inventory_quantity ?? 0) > 0;
    if (available) out.set(String(variant.id), variant.title ?? "");
  }
  return out;
}

/** products/update: স্টকে ফেরা ভ্যারিয়েন্টের অপেক্ষমাণ সবাইকে ইমেইল লাইনে দেয়; কয়জনকে তা ফেরত দেয় */
export async function notifyBackInStock(
  shop: ShopRow,
  payload: ProductPayload,
  now = new Date(),
): Promise<number> {
  const productId = String(payload.id ?? "");
  const variants = purchasableVariants(payload);
  if (!ID.test(productId) || variants.size === 0 || !payload.handle) return 0;
  const where = {
    shopId: shop.id,
    variantId: { in: [...variants.keys()] },
    status: "waiting",
  };
  // বেশিরভাগ প্রোডাক্ট আপডেটে কেউ অপেক্ষায় থাকে না: তখন এখানেই শেষ
  if ((await db.stockAlert.count({ where })) === 0) return 0;
  const settings = await enabledSettings(shop, backInStock);
  if (!settings) return 0;

  let notified = 0;
  for (;;) {
    const alerts = await db.stockAlert.findMany({ where, orderBy: { id: "asc" }, take: PAGE });
    for (const alert of alerts) {
      const variantTitle = variants.get(alert.variantId) ?? "";
      const named = variantTitle && variantTitle !== "Default Title";
      const product = named ? `${payload.title ?? ""} (${variantTitle})` : (payload.title ?? "");
      await enqueueEmail(shop.id, {
        kind: "back-in-stock",
        to: alert.email,
        refId: productId,
        // একই অনুরোধের জন্য একবারই, webhook যতবারই আসুক
        dedupeKey: `bis:${alert.id}:${alert.createdAt.getTime()}`,
        payload: {
          marketing: false,
          vars: { product },
          content: {
            subject: settings.emailSubject || "{product} is back in stock",
            preheader: "",
            heading: product,
            body: settings.emailBody,
            buttonText: settings.emailButton,
            buttonUrl: `${storeUrl(shop)}/products/${payload.handle}?variant=${alert.variantId}`,
            imageUrl: "",
          },
        },
      });
      await db.stockAlert.updateMany({
        where: { id: alert.id, status: "waiting" },
        data: { status: "notified", notifiedAt: now },
      });
      notified++;
    }
    if (alerts.length < PAGE) break;
  }
  return notified;
}

/** অ্যাডমিনের জন্য: কোন প্রোডাক্টে কয়জন অপেক্ষায় */
export async function stockAlertCounts(shopId: string) {
  const [waiting, notified] = await Promise.all([
    db.stockAlert.count({ where: { shopId, status: "waiting" } }),
    db.stockAlert.count({ where: { shopId, status: "notified" } }),
  ]);
  return { waiting, notified };
}
