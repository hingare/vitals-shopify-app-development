import { productReviews } from "@app/tools";
import { z } from "@app/tool-sdk";
import db from "../db.server";
import type { GraphqlClient } from "./tools.server";

import { REVIEW_STATUSES, type ReviewStatus } from "./reviews";

export { REVIEW_STATUSES, type ReviewStatus };
export type ReviewSettings = z.output<typeof productReviews.settings>;

/** স্টোরফ্রন্টের ফর্ম থেকে যা আসে */
const reviewInput = z.object({
  productId: z.string().regex(/^\d{1,20}$/),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional().default(""),
  body: z.string().trim().min(1).max(5000),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().max(200).email().optional().or(z.literal("")).default(""),
  /** honeypot: মানুষ এটা দেখে না, বট ভরে ফেলে */
  website: z.string().optional().default(""),
});
export type ReviewInput = z.output<typeof reviewInput>;

export type ParseResult =
  { ok: true; input: ReviewInput } | { ok: false; error: "invalid" | "spam" };

export function parseReviewInput(body: unknown): ParseResult {
  const parsed = reviewInput.safeParse(body);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (parsed.data.website !== "") return { ok: false, error: "spam" };
  return { ok: true, input: parsed.data };
}

/** সেটিং অনুযায়ী নতুন রিভিউ সঙ্গে সঙ্গে প্রকাশ হবে কিনা */
export function initialStatus(rating: number, autoPublish: ReviewSettings["autoPublish"]) {
  if (autoPublish === "all") return "published";
  if (autoPublish === "4plus" && rating >= 4) return "published";
  return "pending";
}

export function readSettings(raw: unknown): ReviewSettings {
  const parsed = productReviews.settings.safeParse(raw ?? {});
  return parsed.success ? parsed.data : productReviews.settings.parse({});
}

/** স্টোরে টুল চালু থাকলে তার সেটিংস, নইলে null */
export async function enabledReviewSettings(shopId: string): Promise<ReviewSettings | null> {
  const row = await db.toolSetting.findUnique({
    where: { shopId_toolId: { shopId, toolId: productReviews.id } },
  });
  return row?.enabled ? readSettings(row.settings) : null;
}

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function createReview(shopId: string, input: ReviewInput, settings: ReviewSettings) {
  const email = input.email.toLowerCase() || null;
  if (email) {
    const recent = await db.review.findFirst({
      where: {
        shopId,
        productId: input.productId,
        authorEmail: email,
        createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (recent) return { duplicate: true as const };
  }
  const status = initialStatus(input.rating, settings.autoPublish);
  const review = await db.review.create({
    data: {
      shopId,
      productId: input.productId,
      rating: input.rating,
      title: input.title || null,
      body: input.body,
      authorName: input.name,
      authorEmail: email,
      status,
      source: "form",
    },
  });
  return { duplicate: false as const, review };
}

export interface RatingSummary {
  average: number;
  count: number;
  /** distribution[0] = ১ স্টার, distribution[4] = ৫ স্টার */
  distribution: [number, number, number, number, number];
}

export function summarize(
  rows: Array<{ rating: number; _count: { _all: number } }>,
): RatingSummary {
  const distribution: RatingSummary["distribution"] = [0, 0, 0, 0, 0];
  let count = 0;
  let sum = 0;
  for (const row of rows) {
    if (row.rating < 1 || row.rating > 5) continue;
    distribution[row.rating - 1] += row._count._all;
    count += row._count._all;
    sum += row.rating * row._count._all;
  }
  const average = count === 0 ? 0 : Math.round((sum / count) * 10) / 10;
  return { average, count, distribution };
}

export async function ratingSummary(shopId: string, productId: string): Promise<RatingSummary> {
  const rows = await db.review.groupBy({
    by: ["rating"],
    where: { shopId, productId, status: "published" },
    _count: { _all: true },
  });
  return summarize(rows);
}

/** স্টোরে দেখানোর জন্য প্রকাশিত রিভিউ (ইমেইল কখনো যায় না) */
export async function publishedReviews(
  shopId: string,
  productId: string,
  page: number,
  perPage: number,
) {
  const safePage = Math.max(1, Math.min(page, 500));
  const [summary, rows] = await Promise.all([
    ratingSummary(shopId, productId),
    db.review.findMany({
      where: { shopId, productId, status: "published" },
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        authorName: true,
        verified: true,
        reply: true,
        createdAt: true,
      },
    }),
  ]);
  return {
    summary,
    page: safePage,
    hasMore: safePage * perPage < summary.count,
    reviews: rows.map((r) => ({
      ...r,
      authorName: shortName(r.authorName),
      createdAt: r.createdAt.toISOString().slice(0, 10),
    })),
  };
}

/** গোপনীয়তার জন্য স্টোরে পুরো নাম না দেখিয়ে "Rahim K." এভাবে দেখায় */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

/**
 * প্রোডাক্টের স্ট্যান্ডার্ড রিভিউ metafield আপডেট করে।
 * Dawn সহ বেশিরভাগ থিম এগুলো পড়ে প্রোডাক্ট কার্ডে স্টার দেখায়, আর Liquid দিয়ে JSON-LD বানানো যায়।
 */
export async function syncProductRating(admin: GraphqlClient, shopId: string, productId: string) {
  const summary = await ratingSummary(shopId, productId);
  const ownerId = `gid://shopify/Product/${productId}`;
  if (summary.count === 0) {
    await admin.graphql(
      `#graphql
      mutation ClearProductRating($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) { userErrors { message } }
      }`,
      {
        variables: {
          metafields: [
            { ownerId, namespace: "reviews", key: "rating" },
            { ownerId, namespace: "reviews", key: "rating_count" },
          ],
        },
      },
    );
    return summary;
  }
  const res = await admin.graphql(
    `#graphql
    mutation SetProductRating($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: "reviews",
            key: "rating",
            type: "rating",
            value: JSON.stringify({
              value: summary.average.toFixed(1),
              scale_min: "1.0",
              scale_max: "5.0",
            }),
          },
          {
            ownerId,
            namespace: "reviews",
            key: "rating_count",
            type: "number_integer",
            value: String(summary.count),
          },
        ],
      },
    },
  );
  const json = (await res.json()) as {
    data?: { metafieldsSet?: { userErrors: Array<{ message: string }> } };
  };
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
  return summary;
}

/** অ্যাডমিনের রিভিউ তালিকা */
export async function listReviews(
  shopId: string,
  status: ReviewStatus,
  page: number,
  perPage = 25,
) {
  const where = { shopId, status };
  const [total, rows] = await Promise.all([
    db.review.count({ where }),
    db.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (Math.max(1, page) - 1) * perPage,
      take: perPage,
    }),
  ]);
  return { total, rows };
}

export async function statusCounts(shopId: string) {
  const rows = await db.review.groupBy({
    by: ["status"],
    where: { shopId },
    _count: { _all: true },
  });
  const counts: Record<ReviewStatus, number> = { pending: 0, published: 0, rejected: 0 };
  for (const r of rows) {
    if ((REVIEW_STATUSES as readonly string[]).includes(r.status)) {
      counts[r.status as ReviewStatus] = r._count._all;
    }
  }
  return counts;
}

/**
 * মডারেশন: প্রকাশ, বাতিল, মুছে ফেলা বা উত্তর দেওয়া।
 * যেসব প্রোডাক্টের রিভিউ বদলেছে তাদের id ফেরত দেয়, যাতে রেটিং metafield আবার হিসাব হয়।
 */
export async function moderate(
  shopId: string,
  ids: string[],
  action:
    | { type: "status"; status: ReviewStatus }
    | { type: "delete" }
    | { type: "reply"; reply: string },
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.review.findMany({
    where: { shopId, id: { in: ids } },
    select: { id: true, productId: true },
  });
  const ownIds = rows.map((r) => r.id);
  if (action.type === "status") {
    await db.review.updateMany({
      where: { shopId, id: { in: ownIds } },
      data: { status: action.status },
    });
  } else if (action.type === "delete") {
    await db.review.deleteMany({ where: { shopId, id: { in: ownIds } } });
  } else {
    const reply = action.reply.trim().slice(0, 2000);
    await db.review.updateMany({
      where: { shopId, id: { in: ownIds } },
      data: { reply: reply || null, repliedAt: reply ? new Date() : null },
    });
    return [];
  }
  return [...new Set(rows.map((r) => r.productId).filter((p): p is string => Boolean(p)))];
}

/** GDPR customers/redact: ক্রেতার নাম ও ইমেইল মুছে রিভিউ বেনামী করে */
export async function redactCustomerReviews(shopDomain: string, email: string | undefined) {
  if (!email) return 0;
  const shop = await db.shop.findUnique({ where: { domain: shopDomain }, select: { id: true } });
  if (!shop) return 0;
  const result = await db.review.updateMany({
    where: { shopId: shop.id, authorEmail: email.toLowerCase() },
    data: { authorEmail: null, authorName: "Customer" },
  });
  return result.count;
}

/** অ্যাডমিন তালিকায় প্রোডাক্টের নাম দেখাতে */
export async function productTitles(
  admin: GraphqlClient,
  productIds: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(productIds)].slice(0, 100);
  if (unique.length === 0) return {};
  try {
    const res = await admin.graphql(
      `#graphql
      query ReviewProductTitles($ids: [ID!]!) {
        nodes(ids: $ids) { ... on Product { id title } }
      }`,
      { variables: { ids: unique.map((id) => `gid://shopify/Product/${id}`) } },
    );
    const json = (await res.json()) as {
      data?: { nodes?: Array<{ id?: string; title?: string } | null> };
    };
    const titles: Record<string, string> = {};
    for (const node of json.data?.nodes ?? []) {
      if (node?.id && node.title) titles[node.id.split("/").pop()!] = node.title;
    }
    return titles;
  } catch {
    return {};
  }
}
