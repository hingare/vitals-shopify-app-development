import { backInStock } from "@app/tools";
import db from "../db.server";
import { gql, offlineAdmin } from "./admin-client.server";
import { queueEvent } from "./integrations.server";
import { enqueueEmail } from "./messages.server";
import { enqueueJob, registerJob } from "./queue.server";
import { subscribe } from "./subscribers.server";
import { cleanEmail, enabledSettings, type ShopRef } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * Back in Stock: ক্রেতা স্টক-শেষ ভ্যারিয়েন্টের জন্য ইমেইল রেখে যান। Shopify থেকে products/update এলে, আর সেই
 * প্রোডাক্টের জন্য কেউ অপেক্ষায় থাকলে, একটু পরে Shopify-কে জিজ্ঞেস করা হয় ভ্যারিয়েন্টটা এখন সত্যিই কেনা যায় কিনা;
 * গেলে অপেক্ষায় থাকা সবাইকে একবার করে ইমেইল যায়।
 * এই ইমেইল ক্রেতার নিজের চাওয়া (মার্কেটিং নয়), তাই নিউজলেটারে রাজি না হলেও যায়।
 *
 * webhook-এর payload দেখে "স্টকে ফিরেছে" ধরা হয় না: তাতে লেখা থাকে না ভ্যারিয়েন্টের স্টক গোনা হয় কিনা, আর
 * সংখ্যাটা সব লোকেশনের যোগফল (অনলাইনে বিক্রি হয় না এমন লোকেশনসহ)। তাই payload থেকে শুধু জানা হয় কোন
 * প্রোডাক্ট বদলেছে; কেনা যায় কিনা তা Shopify-র availableForSale বলে, স্টোরফ্রন্টও যেটা দেখায়।
 */
type ShopRow = ShopRef & { domain: string };

const ID = /^\d{1,20}$/;
/** একটা ঠিকানা থেকে একসাথে এর বেশি অপেক্ষার অনুরোধ নয় (অপব্যবহার ঠেকাতে) */
const MAX_WAITING_PER_EMAIL = 50;

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
}

export const STOCK_JOB = "stock-check";
/**
 * webhook-এর একটু পরে দেখা হয়: ততক্ষণে Shopify-র উত্তরে নতুন স্টক পৌঁছে যায়, আর একই প্রোডাক্টে পরপর অনেক
 * আপডেট এলে (স্টক মেলানোর অ্যাপ) একবারই দেখা হয়।
 */
const CHECK_DELAY_MS = 30_000;
/** এক পালায় সর্বোচ্চ এতজনকে; বাকিরা পরের পালায়, তখন স্টক আবার মিলিয়ে দেখা হয় */
const PER_RUN = 500;
const VARIANTS_PER_PAGE = 250;

/**
 * products/update আর products/create: এই প্রোডাক্টের জন্য কেউ অপেক্ষায় থাকলে স্টক দেখার কাজ লাইনে দেয়।
 * webhook-এর ভেতরে Shopify-কে জিজ্ঞেস করা বা ইমেইল বানানো হয় না, যাতে উত্তর সাথে সাথে যায়।
 * payload থেকে শুধু প্রোডাক্টের id পড়া হয়: ভ্যারিয়েন্টের তালিকা Shopify ১০০টার পরে আর পুরো পাঠায় না।
 */
export async function queueStockCheck(
  shop: ShopRef,
  payload: ProductPayload,
  now = new Date(),
): Promise<boolean> {
  const productId = String(payload.id ?? "");
  if (!ID.test(productId)) return false;
  // বেশিরভাগ প্রোডাক্ট আপডেটে কেউ অপেক্ষায় থাকে না: তখন এখানেই শেষ
  const waiting = await db.stockAlert.count({
    where: { shopId: shop.id, productId, status: "waiting" },
  });
  if (waiting === 0) return false;
  if (!(await enabledSettings(shop, backInStock))) return false;
  const kind = `${STOCK_JOB}:${productId}`;
  // চলতে থাকা কাজ হয়তো পুরোনো স্টক পড়ে ফেলেছে, তাই শুধু এখনো শুরু না হওয়া কাজ থাকলেই নতুনটা লাগে না
  const pending = await db.job.findFirst({ where: { shopId: shop.id, kind, status: "pending" } });
  if (pending) return false;
  await enqueueJob(
    shop.id,
    kind,
    { productId },
    { runAt: new Date(now.getTime() + CHECK_DELAY_MS) },
  );
  return true;
}

interface StockData {
  product: {
    title: string;
    status: string;
    /** অনলাইন স্টোরে প্রকাশিত না হলে null */
    onlineStoreUrl: string | null;
    variants: {
      nodes: Array<{ id: string; title: string; availableForSale: boolean }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

/** ক্রেতা লিংক খুলে কিনতে পারেন এমন অবস্থা (UNLISTED প্রোডাক্ট খোঁজায় আসে না, কিন্তু লিংকে খোলে) */
const OPEN_STATUSES = ["ACTIVE", "UNLISTED"];

function productLink(base: string, variantId: string): string {
  const url = new URL(base);
  url.searchParams.set("variant", variantId);
  return url.toString();
}

/**
 * এক প্রোডাক্টের যে ভ্যারিয়েন্টগুলো এখন কেনা যায়, তাদের অপেক্ষায় থাকা সবাইকে ইমেইল লাইনে দেয়।
 * ফেরত দেয় কয়জনকে দেওয়া হলো, আর এক পালার সীমায় থেমে গিয়ে থাকলে more: true।
 */
export async function notifyBackInStock(
  admin: GraphqlClient,
  shop: ShopRef,
  productId: string,
  now = new Date(),
): Promise<{ notified: number; more: boolean }> {
  const settings = await enabledSettings(shop, backInStock);
  if (!settings || !ID.test(productId)) return { notified: 0, more: false };

  let notified = 0;
  let cursor: string | null = null;
  do {
    const data: StockData = await gql<StockData>(
      admin,
      `#graphql
      query StockOfProduct($id: ID!, $first: Int!, $after: String) {
        product(id: $id) {
          title
          status
          onlineStoreUrl
          variants(first: $first, after: $after) {
            nodes { id title availableForSale }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: `gid://shopify/Product/${productId}`, first: VARIANTS_PER_PAGE, after: cursor },
    );
    const product = data.product;
    // মোছা, ড্রাফট বা অনলাইন স্টোরে না থাকা প্রোডাক্ট: ইমেইলের লিংক খুলত না, তাই অনুরোধগুলো অপেক্ষাতেই থাকে
    if (!product?.onlineStoreUrl || !OPEN_STATUSES.includes(product.status)) break;
    const available = new Map(
      product.variants.nodes
        .filter((variant) => variant.availableForSale)
        .map((variant) => [variant.id.split("/").pop() ?? "", variant.title]),
    );
    if (available.size > 0) {
      const alerts = await db.stockAlert.findMany({
        where: { shopId: shop.id, variantId: { in: [...available.keys()] }, status: "waiting" },
        orderBy: { id: "asc" },
        take: PER_RUN - notified,
      });
      for (const alert of alerts) {
        const variantTitle = available.get(alert.variantId) ?? "";
        const named = variantTitle && variantTitle !== "Default Title";
        const name = named ? `${product.title} (${variantTitle})` : product.title;
        await enqueueEmail(shop.id, {
          kind: "back-in-stock",
          to: alert.email,
          refId: productId,
          // একই অনুরোধের জন্য একবারই, কাজটা যতবারই চলুক
          dedupeKey: `bis:${alert.id}:${alert.createdAt.getTime()}`,
          payload: {
            marketing: false,
            vars: { product: name },
            content: {
              subject: settings.emailSubject || "{product} is back in stock",
              preheader: "",
              heading: name,
              body: settings.emailBody,
              buttonText: settings.emailButton,
              buttonUrl: productLink(product.onlineStoreUrl, alert.variantId),
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
      if (notified >= PER_RUN) return { notified, more: true };
    }
    const page = product.variants.pageInfo;
    cursor = page.hasNextPage ? page.endCursor : null;
  } while (cursor);
  return { notified, more: false };
}

registerJob(STOCK_JOB, async (job) => {
  const shop = await db.shop.findUnique({ where: { id: job.shopId } });
  if (!shop || shop.uninstalledAt) return;
  const productId = String(job.payload.productId ?? "");
  const result = await notifyBackInStock(await offlineAdmin(shop.domain), shop, productId);
  // সীমায় থেমে থাকলে বাকিদের জন্য আবার চলে (তখন স্টক নতুন করে দেখা হয়)
  return result.more ? { again: true } : undefined;
});

/** অ্যাডমিনের জন্য: কোন প্রোডাক্টে কয়জন অপেক্ষায় */
export async function stockAlertCounts(shopId: string) {
  const [waiting, notified] = await Promise.all([
    db.stockAlert.count({ where: { shopId, status: "waiting" } }),
    db.stockAlert.count({ where: { shopId, status: "notified" } }),
  ]);
  return { waiting, notified };
}
