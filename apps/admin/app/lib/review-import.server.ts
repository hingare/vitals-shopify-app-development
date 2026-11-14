import db from "../db.server";
import { parseCsv } from "./csv";
import { MAX_IMPORT_ROWS } from "./reviews";
import { syncProductRatings } from "./reviews.server";
import { queueSummaryRefresh } from "./ai/tasks/review-summary.server";
import type { GraphqlClient } from "./tools.server";

export { MAX_IMPORT_ROWS };

/**
 * বিভিন্ন অ্যাপের CSV (Judge.me, Loox, Shopify Product Reviews, আমাদের নিজের) একই ফরম্যাটে আনে।
 * প্রতিটি ফিল্ডের জন্য সম্ভাব্য কলামের নাম, প্রথম যেটা পাওয়া যায় সেটা নেওয়া হয়।
 */
const ALIASES = {
  rating: ["rating", "stars", "review_score", "score", "star_rating"],
  body: ["body", "review", "content", "review_body", "comment", "review_content"],
  title: ["title", "review_title", "heading"],
  name: ["reviewer_name", "author", "name", "customer_name", "review_author", "author_name"],
  email: ["reviewer_email", "email", "customer_email", "author_email"],
  productId: ["product_id", "productid", "shopify_product_id"],
  handle: ["product_handle", "handle", "product_url_handle"],
  date: ["review_date", "created_at", "date", "submitted_at"],
  reply: ["reply", "response", "store_reply", "merchant_reply"],
  verified: ["verified", "verified_buyer", "verified_purchase"],
} as const;

type Field = keyof typeof ALIASES;

function pick(record: Record<string, string>, field: Field): string {
  for (const key of ALIASES[field]) {
    const value = record[key];
    if (value) return value;
  }
  return "";
}

export interface ImportRow {
  rating: number;
  body: string;
  title: string | null;
  name: string;
  email: string | null;
  productId: string | null;
  handle: string | null;
  createdAt: Date | null;
  reply: string | null;
  verified: boolean;
}

export type MapResult = { ok: true; row: ImportRow } | { ok: false; reason: string };

/** এক সারি CSV থেকে রিভিউ; সমস্যা থাকলে কারণ সহ বাদ */
export function mapRow(record: Record<string, string>): MapResult {
  const rating = Math.round(Number(pick(record, "rating")));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return { ok: false, reason: "rating" };
  const body = pick(record, "body").slice(0, 5000);
  if (!body) return { ok: false, reason: "body" };

  const rawId = pick(record, "productId").replace(/^gid:\/\/shopify\/Product\//, "");
  const productId = /^\d{1,20}$/.test(rawId) ? rawId : null;
  const handle = pick(record, "handle").split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
  if (!productId && !handle) return { ok: false, reason: "product" };

  const email = pick(record, "email").toLowerCase();
  const date = new Date(pick(record, "date"));
  const verified = /^(true|yes|1|verified)$/i.test(pick(record, "verified"));

  return {
    ok: true,
    row: {
      rating,
      body,
      title: pick(record, "title").slice(0, 120) || null,
      name: (pick(record, "name") || "Customer").slice(0, 80),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 200) : null,
      productId,
      handle: productId ? null : handle,
      createdAt: Number.isNaN(date.getTime()) || date.getTime() > Date.now() ? null : date,
      reply: pick(record, "reply").slice(0, 2000) || null,
      verified,
    },
  };
}

/** handle থেকে প্রোডাক্ট id (৫০টা করে এক কোয়েরিতে) */
async function resolveHandles(admin: GraphqlClient, handles: string[]) {
  const ids = new Map<string, string>();
  const unique = [...new Set(handles)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const query = batch.map((h) => `handle:'${h.replace(/['\\]/g, "")}'`).join(" OR ");
    const res = await admin.graphql(
      `#graphql
      query ReviewImportProducts($query: String!) {
        products(first: 50, query: $query) { nodes { id handle } }
      }`,
      { variables: { query } },
    );
    const json = (await res.json()) as {
      data?: { products?: { nodes: Array<{ id: string; handle: string }> } };
    };
    for (const node of json.data?.products?.nodes ?? []) {
      ids.set(node.handle.toLowerCase(), node.id.split("/").pop()!);
    }
  }
  return ids;
}

const dedupeKey = (r: { productId: string | null; authorName: string; body: string }) =>
  `${r.productId}|${r.authorName.toLowerCase()}|${r.body.slice(0, 200)}`;

export interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  tooMany: boolean;
  /** প্রথম ২০টা সমস্যার লাইন নম্বর ও কারণ */
  errors: Array<{ line: number; reason: string }>;
}

export async function importReviews(
  admin: GraphqlClient,
  shopId: string,
  csvText: string,
  options: { publish: boolean },
): Promise<ImportResult> {
  const records = parseCsv(csvText, MAX_IMPORT_ROWS + 1);
  const tooMany = records.length > MAX_IMPORT_ROWS;
  const errors: ImportResult["errors"] = [];
  const rows: Array<ImportRow & { line: number }> = [];
  records.slice(0, MAX_IMPORT_ROWS).forEach((record, i) => {
    const mapped = mapRow(record);
    if (mapped.ok) rows.push({ ...mapped.row, line: i + 2 });
    else if (errors.length < 20) errors.push({ line: i + 2, reason: mapped.reason });
  });
  let skipped = records.length - (tooMany ? 1 : 0) - rows.length;

  const handleIds = await resolveHandles(
    admin,
    rows.filter((r) => !r.productId && r.handle).map((r) => r.handle!),
  );
  const ready: Array<ImportRow & { productId: string }> = [];
  for (const row of rows) {
    const productId = row.productId ?? (row.handle ? handleIds.get(row.handle) : undefined);
    if (productId) {
      ready.push({ ...row, productId });
    } else {
      skipped++;
      if (errors.length < 20) errors.push({ line: row.line, reason: "product_not_found" });
    }
  }

  // আগে থেকে থাকা বা ফাইলে দুবার থাকা রিভিউ বাদ (আবার ইমপোর্ট করলে ডুপ্লিকেট হয় না)
  const productIds = [...new Set(ready.map((r) => r.productId))];
  const existing = await db.review.findMany({
    where: { shopId, productId: { in: productIds } },
    select: { productId: true, authorName: true, body: true },
  });
  const seen = new Set(existing.map(dedupeKey));
  let duplicates = 0;
  const data = [];
  for (const row of ready) {
    const key = dedupeKey({ productId: row.productId, authorName: row.name, body: row.body });
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    data.push({
      shopId,
      productId: row.productId,
      rating: row.rating,
      title: row.title,
      body: row.body,
      authorName: row.name,
      authorEmail: row.email,
      verified: row.verified,
      status: options.publish ? "published" : "pending",
      source: "import",
      reply: row.reply,
      repliedAt: row.reply ? new Date() : null,
      ...(row.createdAt ? { createdAt: row.createdAt } : {}),
    });
  }
  for (let i = 0; i < data.length; i += 1000) {
    await db.review.createMany({ data: data.slice(i, i + 1000) });
  }

  if (options.publish && data.length > 0) {
    const products = [...new Set(data.map((d) => d.productId))];
    await syncProductRatings(admin, shopId, products);
    // AI Review Summary: আমদানি করা রিভিউ থেকেও সারাংশ (টুল চালু থাকলে, কিছুক্ষণ পরে)
    await queueSummaryRefresh(shopId, products).catch((error) =>
      console.warn("[reviews] summary refresh failed", error),
    );
  }
  return { imported: data.length, skipped, duplicates, tooMany, errors };
}
