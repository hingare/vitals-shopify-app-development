import { brand } from "@app/brand";
import { OFFER_TOOL_BY_TYPE } from "@app/tools";
import { z } from "@app/tool-sdk";
import db from "../db.server";
import {
  AB_GROUPS,
  AUDIENCES,
  CONFLICT_MODES,
  DEFAULT_LABELS,
  OFFER_TYPES,
  type OfferType,
  UPSELL_PLACEMENTS,
} from "./offers";
import type { GraphqlClient } from "./tools.server";

export { OFFER_TYPES, type OfferType };

/** Rust function-এর handle (extensions/offers-discount/shopify.extension.toml) */
export const FUNCTION_HANDLE = "offers-discount";
export const FUNCTION_NAMESPACE = "$app:offers";
export const FUNCTION_KEY = "config";
export const FUNCTION_INPUT_KEY = "input";

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

const label = z.string().trim().max(80).default("");

/** অফার কখন ও কাকে (Rust function-এর Rules-এর সাথে মিল রেখে) */
export const rulesSchema = z.preprocess(
  (v) => v ?? {},
  z
    .object({
      startsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .or(z.literal(""))
        .default(""),
      endsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .or(z.literal(""))
        .default(""),
      /** স্টোরের মূল মুদ্রায়, ০ = শর্ত নেই */
      minSubtotal: z.number().min(0).max(1_000_000).default(0),
      audience: z.enum(AUDIENCES).default("all"),
      customerTags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
      countries: z
        .array(z.string().regex(/^[A-Z]{2}$/))
        .max(50)
        .default([]),
      abGroup: z.enum(AB_GROUPS).default(""),
      /** বড় সংখ্যা আগে ("priority" মোডে) */
      priority: z.number().int().min(0).max(100).default(0),
    })
    .refine((r) => !r.startsOn || !r.endsOn || r.startsOn <= r.endsOn, {
      message: "The end date must be after the start date",
    }),
);

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
  message: label,
  rules: rulesSchema,
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
  message: label,
  rules: rulesSchema,
});

const variantRef = z.object({
  id: z.string().regex(/^\d{1,20}$/),
  productId: z.string().regex(/^\d{1,20}$/),
  handle: z.string().min(1).max(255),
  title: z.string().max(255),
});

export const giftConfig = z
  .object({
    /** এগুলোর কোনোটা কিনলে (খালি = যেকোনো প্রোডাক্ট) */
    products: z.array(productRef).max(100).default([]),
    minQty: z.number().int().min(1).max(100).default(1),
    gift: variantRef,
    giftQty: z.number().int().min(1).max(5).default(1),
    /** স্টোরফ্রন্টে "আর X টাকা কিনলে গিফট" লেখা */
    progressText: z.string().trim().max(120).default(""),
    message: label,
    rules: rulesSchema,
  })
  .refine((c) => c.products.length > 0 || c.rules.minSubtotal > 0 || c.minQty > 1, {
    message: "Set a minimum cart amount, a quantity or products that unlock the gift",
  });

export const bogoConfig = z.object({
  buyProducts: z.array(productRef).max(100).default([]),
  buyQty: z.number().int().min(1).max(20),
  /** খালি = buyProducts-এর যেকোনোটা */
  getProducts: z.array(productRef).max(100).default([]),
  getQty: z.number().int().min(1).max(20),
  value: discountValue,
  /** এক অর্ডারে সর্বোচ্চ কতবার (০ = সীমা নেই) */
  maxUses: z.number().int().min(0).max(100).default(1),
  message: label,
  rules: rulesSchema,
});

export const upsellConfig = z.object({
  /** এগুলোর কোনোটা কার্টে বা পেজে থাকলে প্রস্তাব (খালি = যেকোনো প্রোডাক্ট) */
  triggerProducts: z.array(productRef).max(100).default([]),
  products: z.array(productRef).min(1).max(4),
  /** ছাড় ঐচ্ছিক; percent 0 মানে ছাড় নেই, শুধু প্রস্তাব */
  value: z
    .object({
      percent: z.number().min(0).max(100).optional(),
      amountEach: z.number().min(0.01).max(1_000_000).optional(),
    })
    .default({ percent: 0 }),
  title: z.string().trim().max(80).default(""),
  placements: z.array(z.enum(UPSELL_PLACEMENTS)).min(1).default(["popup", "cart"]),
  message: label,
  rules: rulesSchema,
});

/** স্টোর জুড়ে অফারের সেটিংস (Shop.offerSettings) */
export const offerSettingsSchema = z.object({
  conflict: z.enum(CONFLICT_MODES).default("best"),
});
export type OfferSettings = z.output<typeof offerSettingsSchema>;

export function readOfferSettings(raw: unknown): OfferSettings {
  const parsed = offerSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : offerSettingsSchema.parse({});
}

export type VolumeConfig = z.output<typeof volumeConfig>;
export type BundleConfig = z.output<typeof bundleConfig>;
export type GiftConfig = z.output<typeof giftConfig>;
export type BogoConfig = z.output<typeof bogoConfig>;
export type UpsellConfig = z.output<typeof upsellConfig>;
export type Rules = z.output<typeof rulesSchema>;

const SCHEMAS = {
  volume: volumeConfig,
  bundle: bundleConfig,
  gift: giftConfig,
  bogo: bogoConfig,
  upsell: upsellConfig,
};

export function parseOfferConfig(type: OfferType, raw: unknown) {
  return SCHEMAS[type].safeParse(raw);
}

interface OfferRow {
  id: string;
  type: string;
  name?: string;
  active: boolean;
  config: unknown;
}

/** অফারের লেবেল: মার্চেন্টের লেখা, না থাকলে ধরন অনুযায়ী ডিফল্ট (রিপোর্টে এটা দিয়েই অফার চেনা হয়) */
export function offerLabel(type: OfferType, message: string | undefined) {
  return message?.trim() || DEFAULT_LABELS[type];
}

/** function-এর Rules (খালি মান বাদ দিয়ে, যাতে কনফিগ ছোট থাকে) */
function fnRules(r: Rules) {
  const out: Record<string, unknown> = {};
  if (r.startsOn) out.startsOn = r.startsOn;
  if (r.endsOn) out.endsOn = r.endsOn;
  if (r.minSubtotal > 0) out.minSubtotal = r.minSubtotal;
  if (r.audience !== "all") out.audience = r.audience;
  if (r.customerTags.length) out.customerTags = r.customerTags;
  if (r.countries.length) out.countries = r.countries;
  if (r.abGroup) out.abGroup = r.abGroup;
  return out;
}

/** স্টোরফ্রন্টে যতটুকু যাচাই করা যায় (তারিখ, A/B, ন্যূনতম কার্ট); বাকিটা চেকআউটে */
function storefrontRules(r: Rules) {
  return {
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    abGroup: r.abGroup,
    minSubtotal: r.minSubtotal,
    /** ক্রেতা বা দেশের শর্ত থাকলে স্টোরফ্রন্ট নিশ্চিত হতে পারে না */
    restricted: r.audience !== "all" || r.customerTags.length > 0 || r.countries.length > 0,
  };
}

/** চেকআউটের function আর স্টোরফ্রন্ট উইজেটের জন্য অফারের কনফিগ */
export function buildOfferConfigs(
  offers: OfferRow[],
  enabledToolIds: string[],
  settings: OfferSettings = offerSettingsSchema.parse({}),
) {
  const enabled = new Set(enabledToolIds);
  const fn: Array<Record<string, unknown>> = [];
  const tags = new Set<string>();
  const storefront = {
    volume: [] as Array<Record<string, unknown>>,
    bundles: [] as Array<Record<string, unknown>>,
    gifts: [] as Array<Record<string, unknown>>,
    bogo: [] as Array<Record<string, unknown>>,
    upsells: [] as Array<Record<string, unknown>>,
    /** কোনো অফার A/B টেস্টে থাকলে স্টোরফ্রন্ট ক্রেতাকে একটা গ্রুপে রাখে */
    ab: false,
  };
  for (const offer of offers) {
    if (!offer.active) continue;
    const type = offer.type as OfferType;
    if (!(OFFER_TYPES as readonly string[]).includes(type)) continue;
    if (!enabled.has(OFFER_TOOL_BY_TYPE[type])) continue;
    const parsed = parseOfferConfig(type, offer.config);
    if (!parsed.success) continue;
    const c = parsed.data;
    const rules = c.rules;
    for (const tag of rules.customerTags) tags.add(tag);
    if (rules.abGroup) storefront.ab = true;
    const base = {
      id: offer.id,
      priority: rules.priority,
      message: offerLabel(type, c.message),
      rules: fnRules(rules),
    };
    const sfRules = storefrontRules(rules);

    if (type === "volume") {
      const v = c as VolumeConfig;
      const productIds = v.products.map((p) => p.id);
      const tiers = [...v.tiers].sort((a, b) => a.minQty - b.minQty);
      fn.push({ ...base, type: "volume", productIds, tiers });
      storefront.volume.push({ id: offer.id, productIds, tiers, rules: sfRules });
    } else if (type === "bundle") {
      const b = c as BundleConfig;
      fn.push({
        ...base,
        type: "bundle",
        items: b.products.map((p) => ({ productId: p.id, qty: p.qty })),
        value: b.value,
      });
      storefront.bundles.push({
        id: offer.id,
        title: b.title,
        value: b.value,
        items: b.products.map((p) => ({ productId: p.id, handle: p.handle, qty: p.qty })),
        rules: sfRules,
      });
    } else if (type === "gift") {
      const g = c as GiftConfig;
      const triggerProductIds = g.products.map((p) => p.id);
      fn.push({
        ...base,
        type: "gift",
        triggerProductIds,
        minQty: g.minQty,
        giftVariantId: g.gift.id,
        giftQty: g.giftQty,
      });
      storefront.gifts.push({
        id: offer.id,
        triggerProductIds,
        minQty: g.minQty,
        variantId: g.gift.id,
        handle: g.gift.handle,
        title: g.gift.title,
        qty: g.giftQty,
        progressText: g.progressText,
        rules: sfRules,
      });
    } else if (type === "upsell") {
      const u = c as UpsellConfig;
      const triggerProductIds = u.triggerProducts.map((p) => p.id);
      const discounted = (u.value.percent ?? 0) > 0 || (u.value.amountEach ?? 0) > 0;
      // ছাড় থাকলে চেকআউটে "trigger ১টা কিনলে upsell ১টা ছাড়ে" (BOGO-র নিয়মেই, যতবার মেলে)
      if (discounted) {
        fn.push({
          ...base,
          type: "bogo",
          buyProductIds: triggerProductIds,
          buyQty: 1,
          getProductIds: u.products.map((p) => p.id),
          getQty: 1,
          value: u.value,
          maxUses: 0,
        });
      }
      storefront.upsells.push({
        id: offer.id,
        triggerProductIds,
        products: u.products.map((p) => ({ id: p.id, handle: p.handle })),
        value: discounted ? u.value : null,
        title: u.title,
        placements: u.placements,
        rules: sfRules,
      });
    } else {
      const x = c as BogoConfig;
      const buyProductIds = x.buyProducts.map((p) => p.id);
      const getProductIds = x.getProducts.map((p) => p.id);
      fn.push({
        ...base,
        type: "bogo",
        buyProductIds,
        buyQty: x.buyQty,
        getProductIds,
        getQty: x.getQty,
        value: x.value,
        maxUses: x.maxUses,
      });
      storefront.bogo.push({
        id: offer.id,
        buyProductIds,
        buyQty: x.buyQty,
        getProductIds,
        getQty: x.getQty,
        value: x.value,
        rules: sfRules,
      });
    }
  }
  return {
    fn: { offers: fn, conflict: settings.conflict },
    /** function-এর input query-র variables ($app:offers.input metafield) */
    input: { customerTags: [...tags] },
    storefront,
  };
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
/** discount-এর দুটো metafield: অফারের কনফিগ আর input query-র variables */
function discountMetafields(config: string, input: string) {
  return [
    { namespace: FUNCTION_NAMESPACE, key: FUNCTION_KEY, type: "json", value: config },
    { namespace: FUNCTION_NAMESPACE, key: FUNCTION_INPUT_KEY, type: "json", value: input },
  ];
}

async function createDiscount(admin: GraphqlClient, config: string, input: string) {
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
        title: `${brand.name}: offers`,
        functionHandle: FUNCTION_HANDLE,
        startsAt: new Date().toISOString(),
        discountClasses: ["PRODUCT"],
        combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true },
        metafields: discountMetafields(config, input),
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
async function writeDiscountConfig(
  admin: GraphqlClient,
  discountId: string,
  config: string,
  input: string,
) {
  const json = await gql<{
    data?: { metafieldsSet?: { userErrors: Array<{ message: string; code?: string }> } };
  }>(
    admin,
    `#graphql
    mutation SetOffersConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message code } }
    }`,
    {
      metafields: discountMetafields(config, input).map((m) => ({ ...m, ownerId: discountId })),
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
    db.shop.findUnique({
      where: { id: shop.id },
      select: { offersDiscountId: true, offerSettings: true },
    }),
  ]);
  const { fn, input, storefront } = buildOfferConfigs(
    offers,
    enabledToolIds,
    readOfferSettings(row?.offerSettings),
  );
  const config = JSON.stringify(fn);
  const variables = JSON.stringify(input);

  let discountId = row?.offersDiscountId ?? null;
  if (discountId && !(await writeDiscountConfig(admin, discountId, config, variables))) {
    discountId = null;
  }
  if (!discountId && fn.offers.length > 0) {
    discountId = await createDiscount(admin, config, variables);
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
  // রিপোর্টে অর্ডারের ছাড় কোন অফারের তা লেবেল দিয়ে চেনা হয়, তাই দুটো অফারের এক লেবেল নয়
  const label = offerLabel(input.type, parsed.data.message).toLowerCase();
  const others = await db.offer.findMany({
    where: { shopId, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { type: true, config: true },
  });
  const clash = others.some(
    (o) =>
      offerLabel(
        o.type as OfferType,
        (o.config as { message?: string } | null)?.message,
      ).toLowerCase() === label,
  );
  if (clash) {
    return { ok: false as const, error: "Another offer already uses this discount label" };
  }
  const name = input.name.trim().slice(0, 120) || DEFAULT_LABELS[input.type];
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

export async function saveOfferSettings(shopId: string, raw: unknown) {
  const parsed = offerSettingsSchema.safeParse(raw);
  if (!parsed.success) return false;
  await db.shop.update({ where: { id: shopId }, data: { offerSettings: parsed.data } });
  return true;
}

export async function deleteOffer(shopId: string, id: string) {
  await db.offer.deleteMany({ where: { shopId, id } });
}
