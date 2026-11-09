import { brand } from "@app/brand";
import { OFFER_TOOL_BY_TYPE } from "@app/tools";
import { z } from "@app/tool-sdk";
import db from "../db.server";
import { OFFER_TYPES, type OfferType } from "./offers";
import type { GraphqlClient } from "./tools.server";

export { OFFER_TYPES, type OfferType };

/** Rust function-এর handle (extensions/offers-discount/shopify.extension.toml) */
export const FUNCTION_HANDLE = "offers-discount";
export const FUNCTION_NAMESPACE = "$app:offers";
export const FUNCTION_KEY = "config";

const discountValue = z
  .object({
    percent: z.number().min(0.1).max(100).optional(),
    amountEach: z.number().min(0.01).max(1_000_000).optional(),
  })
  .refine((v) => (v.percent === undefined) !== (v.amountEach === undefined), {
    message: "Choose a percent or an amount",
  });

const productRef = z.object({
  id: z.string().regex(/^\d{1,20}$/),
  handle: z.string().min(1).max(255),
  title: z.string().max(255),
});

export const volumeConfig = z.object({
  /** খালি মানে সব প্রোডাক্ট */
  products: z.array(productRef).max(100).default([]),
  tiers: z
    .array(z.object({ minQty: z.number().int().min(2).max(1000), value: discountValue }))
    .min(1)
    .max(5)
    .refine((tiers) => new Set(tiers.map((t) => t.minQty)).size === tiers.length, {
      message: "Each tier needs a different quantity",
    }),
  message: z.string().trim().max(80).default(""),
});

export const bundleConfig = z.object({
  products: z
    .array(productRef.extend({ qty: z.number().int().min(1).max(10).default(1) }))
    .min(2)
    .max(5)
    .refine((items) => new Set(items.map((i) => i.id)).size === items.length, {
      message: "Each product can be in the bundle once",
    }),
  value: discountValue,
  title: z.string().trim().max(80).default(""),
  message: z.string().trim().max(80).default(""),
});

export type VolumeConfig = z.output<typeof volumeConfig>;
export type BundleConfig = z.output<typeof bundleConfig>;

export function parseOfferConfig(type: OfferType, raw: unknown) {
  return type === "volume" ? volumeConfig.safeParse(raw) : bundleConfig.safeParse(raw);
}

interface OfferRow {
  id: string;
  type: string;
  active: boolean;
  config: unknown;
}

/** চেকআউটের function আর স্টোরফ্রন্ট উইজেটের জন্য অফারের কনফিগ */
export function buildOfferConfigs(offers: OfferRow[], enabledToolIds: string[]) {
  const enabled = new Set(enabledToolIds);
  const fn: Array<Record<string, unknown>> = [];
  const storefront = {
    volume: [] as Array<Record<string, unknown>>,
    bundles: [] as Array<Record<string, unknown>>,
  };
  for (const offer of offers) {
    if (!offer.active) continue;
    if (offer.type === "volume" && enabled.has(OFFER_TOOL_BY_TYPE.volume)) {
      const parsed = volumeConfig.safeParse(offer.config);
      if (!parsed.success) continue;
      const c = parsed.data;
      const productIds = c.products.map((p) => p.id);
      const tiers = [...c.tiers].sort((a, b) => a.minQty - b.minQty);
      fn.push({ type: "volume", id: offer.id, productIds, tiers, message: c.message });
      storefront.volume.push({ id: offer.id, productIds, tiers });
    } else if (offer.type === "bundle" && enabled.has(OFFER_TOOL_BY_TYPE.bundle)) {
      const parsed = bundleConfig.safeParse(offer.config);
      if (!parsed.success) continue;
      const c = parsed.data;
      fn.push({
        type: "bundle",
        id: offer.id,
        items: c.products.map((p) => ({ productId: p.id, qty: p.qty })),
        value: c.value,
        message: c.message || c.title,
      });
      storefront.bundles.push({
        id: offer.id,
        title: c.title,
        value: c.value,
        items: c.products.map((p) => ({ productId: p.id, handle: p.handle, qty: p.qty })),
      });
    }
  }
  return { fn: { offers: fn }, storefront };
}

async function gql<T>(
  admin: GraphqlClient,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await admin.graphql(query, { variables });
  return (await res.json()) as T;
}

/** সব অফারের জন্য একটাই automatic discount; না থাকলে বানায় */
async function createDiscount(admin: GraphqlClient, config: string) {
  const json = await gql<{
    data?: {
      discountAutomaticAppCreate?: {
        automaticAppDiscount?: { discountId: string } | null;
        userErrors: Array<{ message: string }>;
      };
    };
  }>(
    admin,
    `#graphql
    mutation CreateOffersDiscount($discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $discount) {
        automaticAppDiscount { discountId }
        userErrors { field message }
      }
    }`,
    {
      discount: {
        title: `${brand.name}: volume discounts and bundles`,
        functionHandle: FUNCTION_HANDLE,
        startsAt: new Date().toISOString(),
        discountClasses: ["PRODUCT"],
        combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true },
        metafields: [
          { namespace: FUNCTION_NAMESPACE, key: FUNCTION_KEY, type: "json", value: config },
        ],
      },
    },
  );
  const result = json.data?.discountAutomaticAppCreate;
  const id = result?.automaticAppDiscount?.discountId;
  if (!id) {
    throw new Error(
      result?.userErrors.map((e) => e.message).join(", ") || "discount create failed",
    );
  }
  return id;
}

/** discount-এর metafield-এ কনফিগ লেখে; discount মুছে গেলে false */
async function writeDiscountConfig(admin: GraphqlClient, discountId: string, config: string) {
  const json = await gql<{
    data?: { metafieldsSet?: { userErrors: Array<{ message: string; code?: string }> } };
  }>(
    admin,
    `#graphql
    mutation SetOffersConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message code } }
    }`,
    {
      metafields: [
        {
          ownerId: discountId,
          namespace: FUNCTION_NAMESPACE,
          key: FUNCTION_KEY,
          type: "json",
          value: config,
        },
      ],
    },
  );
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length === 0) return true;
  if (errors.some((e) => /not exist|not found|INVALID/i.test(`${e.code} ${e.message}`)))
    return false;
  throw new Error(errors.map((e) => e.message).join(", "));
}

/**
 * অফার বা টুলের অবস্থা বদলালে ডাকা হয় (syncStoreConfig থেকে)।
 * চেকআউটের discount কনফিগ আর স্টোরফ্রন্টের অফার তালিকা দুটোই আপডেট করে।
 * কোনো অফার না থাকলে discount বানায় না (মার্চেন্টের Discounts তালিকা পরিষ্কার থাকে)।
 */
export async function syncOffers(
  admin: GraphqlClient,
  shop: { id: string },
  installationId: string,
  enabledToolIds: string[],
) {
  const [offers, row] = await Promise.all([
    db.offer.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "asc" } }),
    db.shop.findUnique({ where: { id: shop.id }, select: { offersDiscountId: true } }),
  ]);
  const { fn, storefront } = buildOfferConfigs(offers, enabledToolIds);
  const config = JSON.stringify(fn);

  let discountId = row?.offersDiscountId ?? null;
  if (discountId && !(await writeDiscountConfig(admin, discountId, config))) discountId = null;
  if (!discountId && fn.offers.length > 0) {
    discountId = await createDiscount(admin, config);
  }
  if (discountId !== (row?.offersDiscountId ?? null)) {
    await db.shop.update({ where: { id: shop.id }, data: { offersDiscountId: discountId } });
  }

  // স্টোরফ্রন্ট উইজেট এটা Liquid থেকে পড়ে (app-owned metafield)
  return {
    ownerId: installationId,
    namespace: "app_config",
    key: "offers",
    type: "json",
    value: JSON.stringify(storefront),
  };
}

export async function listOffers(shopId: string) {
  return db.offer.findMany({ where: { shopId }, orderBy: { createdAt: "desc" } });
}

export async function getOffer(shopId: string, id: string) {
  return db.offer.findFirst({ where: { shopId, id } });
}

export async function saveOffer(
  shopId: string,
  input: { id?: string; type: OfferType; name: string; active: boolean; config: unknown },
) {
  const parsed = parseOfferConfig(input.type, input.config);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid offer" };
  }
  const name =
    input.name.trim().slice(0, 120) || (input.type === "volume" ? "Volume discount" : "Bundle");
  const data = { name, active: input.active, config: parsed.data };
  if (input.id) {
    const existing = await getOffer(shopId, input.id);
    if (!existing) return { ok: false as const, error: "Offer not found" };
    await db.offer.update({ where: { id: existing.id }, data });
    return { ok: true as const, id: existing.id };
  }
  const offer = await db.offer.create({ data: { shopId, type: input.type, ...data } });
  return { ok: true as const, id: offer.id };
}

export async function deleteOffer(shopId: string, id: string) {
  await db.offer.deleteMany({ where: { shopId, id } });
}
