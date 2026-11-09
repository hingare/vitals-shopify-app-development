import { createHmac, randomUUID } from "node:crypto";
import { buildStoreConfig, registry } from "@app/tools";
import type { Plan } from "@app/tool-sdk";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { offerLabel, parseOfferConfig, type UpsellConfig } from "./offers.server";

/**
 * পেমেন্টের পর এক ক্লিকের আপসেল (post-purchase extension)।
 * extension শুধু অফার id আর ভ্যারিয়েন্ট পাঠায়; ছাড় আর পরিবর্তন সবসময় সার্ভারে আমাদের সেভ করা
 * অফার থেকে বানানো হয়, তাই কেউ নিজে ছাড় বসিয়ে সই করিয়ে নিতে পারে না।
 */

interface OfferRow {
  id: string;
  type: string;
  active: boolean;
  config: unknown;
}

export interface PurchaseInfo {
  /** কেনা প্রোডাক্টের সংখ্যা-id (gid নয়) */
  productIds: string[];
  /** স্টোরের মুদ্রায় অর্ডারের মোট */
  total: number;
  /** YYYY-MM-DD */
  today: string;
}

/**
 * প্রথম যে আপসেল অফার post-purchase-এ দেখানো যায়।
 * ক্রেতা, দেশ বা A/B শর্তের অফার এখানে বাদ (এই পেজে ওগুলো যাচাই করা যায় না)।
 */
export function pickPostPurchaseOffer(offers: OfferRow[], purchase: PurchaseInfo) {
  const bought = new Set(purchase.productIds);
  for (const row of offers) {
    if (!row.active || row.type !== "upsell") continue;
    const parsed = parseOfferConfig("upsell", row.config);
    if (!parsed.success) continue;
    const c = parsed.data as UpsellConfig;
    if (!c.placements.includes("post_purchase")) continue;
    const r = c.rules;
    if (r.audience !== "all" || r.customerTags.length > 0 || r.countries.length > 0) continue;
    if (r.abGroup) continue;
    if (r.startsOn && purchase.today < r.startsOn) continue;
    if (r.endsOn && purchase.today > r.endsOn) continue;
    if ((r.minSubtotal ?? 0) > purchase.total) continue;
    const triggered =
      c.triggerProducts.length === 0 || c.triggerProducts.some((p) => bought.has(p.id));
    if (!triggered) continue;
    const products = c.products.filter((p) => !bought.has(p.id));
    if (products.length === 0) continue;
    return { id: row.id, config: c, productIds: products.map((p) => p.id) };
  }
  return null;
}

/** Shopify-র changeset-এ যে পরিবর্তন যাবে (ছাড়ের title অফারের লেবেল, তাই রিপোর্টে গোনা যায়) */
export function postPurchaseChange(config: UpsellConfig, variantId: number) {
  const percent = config.value.percent ?? 0;
  const amount = config.value.amountEach ?? 0;
  const title = offerLabel("upsell", config.message);
  const discount =
    percent > 0
      ? { value: percent, valueType: "percentage" as const, title }
      : amount > 0
        ? { value: amount, valueType: "fixed_amount" as const, title }
        : undefined;
  return {
    type: "add_variant" as const,
    variantId,
    quantity: 1,
    ...(discount ? { discount } : {}),
  };
}

/** Shopify-র post-purchase JWT: HS256, অ্যাপের API secret দিয়ে সই */
export function signChangeset(
  referenceId: string,
  changes: unknown[],
  keys: { apiKey: string; secret: string },
  now = Date.now(),
) {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    iss: keys.apiKey,
    jti: randomUUID(),
    iat: Math.floor(now / 1000),
    sub: referenceId,
    changes,
  });
  const sig = createHmac("sha256", keys.secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** দোকানে Upsells টুল চালু আর প্ল্যানে অনুমোদিত কিনা, সাথে অফারগুলো */
async function shopOffers(domain: string) {
  const shop = await db.shop.findUnique({
    where: { domain },
    select: { id: true, plan: true, uninstalledAt: true },
  });
  if (!shop || shop.uninstalledAt) return null;
  const rows = await db.toolSetting.findMany({ where: { shopId: shop.id, toolId: "upsells" } });
  const { tools } = buildStoreConfig(
    registry,
    rows.map((r) => ({ toolId: r.toolId, enabled: r.enabled, settings: r.settings })),
    shop.plan as Plan | null,
  );
  if (tools.length === 0) return null;
  const offers = await db.offer.findMany({
    where: { shopId: shop.id, type: "upsell", active: true },
    orderBy: { createdAt: "asc" },
  });
  return offers;
}

interface ProductInfo {
  id: string;
  title: string;
  image: string | null;
  variants: Array<{ id: number; title: string; price: string }>;
}

async function loadProducts(domain: string, ids: string[]): Promise<ProductInfo[]> {
  const { admin } = await unauthenticated.admin(domain);
  const res = await admin.graphql(
    `#graphql
    query PostPurchaseProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          status
          featuredMedia { preview { image { url(transform: { maxWidth: 600 }) } } }
          variants(first: 20) {
            nodes { id title price availableForSale }
          }
        }
      }
    }`,
    { variables: { ids: ids.map((id) => `gid://shopify/Product/${id}`) } },
  );
  const json = (await res.json()) as {
    data?: {
      nodes: Array<{
        id?: string;
        title?: string;
        status?: string;
        featuredMedia?: { preview?: { image?: { url?: string } } } | null;
        variants?: {
          nodes: Array<{ id: string; title: string; price: string; availableForSale: boolean }>;
        };
      } | null>;
    };
  };
  const out: ProductInfo[] = [];
  for (const n of json.data?.nodes ?? []) {
    if (!n?.id || n.status !== "ACTIVE") continue;
    const variants = (n.variants?.nodes ?? [])
      .filter((v) => v.availableForSale)
      .map((v) => ({ id: Number(v.id.split("/").pop()), title: v.title, price: v.price }));
    if (variants.length === 0) continue;
    out.push({
      id: n.id.split("/").pop() ?? "",
      title: n.title ?? "",
      image: n.featuredMedia?.preview?.image?.url ?? null,
      variants,
    });
  }
  return out;
}

/** extension-এর ShouldRender থেকে: দেখানোর মতো অফার আর প্রোডাক্ট (না থাকলে null) */
export async function getPostPurchaseOffer(domain: string, purchase: PurchaseInfo) {
  const offers = await shopOffers(domain);
  if (!offers) return null;
  const pick = pickPostPurchaseOffer(offers, purchase);
  if (!pick) return null;
  const products = await loadProducts(domain, pick.productIds);
  if (products.length === 0) return null;
  const c = pick.config;
  return {
    offerId: pick.id,
    title: c.title,
    discount: postPurchaseChange(c, 0).discount ?? null,
    products,
  };
}

/** Accept চাপলে: অফার আর ভ্যারিয়েন্ট যাচাই করে সই করা changeset token */
export async function signPostPurchase(
  domain: string,
  input: { referenceId: string; offerId: string; variantId: number; purchase: PurchaseInfo },
  keys: { apiKey: string; secret: string },
) {
  const offers = await shopOffers(domain);
  if (!offers) return null;
  const pick = pickPostPurchaseOffer(
    offers.filter((o) => o.id === input.offerId),
    input.purchase,
  );
  if (!pick) return null;
  const products = await loadProducts(domain, pick.productIds);
  const allowed = products.some((p) => p.variants.some((v) => v.id === input.variantId));
  if (!allowed) return null;
  return signChangeset(input.referenceId, [postPurchaseChange(pick.config, input.variantId)], keys);
}
