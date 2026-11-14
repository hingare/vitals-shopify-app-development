import { seoMetaTemplates } from "@app/tools";
import { canUseTool, type AnyTool } from "@app/tool-sdk";
import db from "../db.server";
import { gql, offlineAdmin } from "./admin-client.server";
import { clip } from "./ai/text";
import {
  enqueueJob,
  latestJob,
  registerJob,
  type JobContext,
  type JobResult,
} from "./queue.server";
import { renderTemplate } from "./text-template";
import { enabledSettings, type ShopRef } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * SEO Meta Templates: যে প্রোডাক্ট বা কালেকশনের SEO টাইটেল বা বর্ণনা ফাঁকা, শুধু সেখানে নিয়ম অনুযায়ী লেখা বসায়।
 * - মার্চেন্টের নিজের লেখা কখনো বদলায় না।
 * - কী বসানো হলো তা লেখা থাকে (SeoMetaChange), তাই এক ক্লিকে ফাঁকা অবস্থায় ফেরানো যায়; ফেরানোর সময়
 *   Shopify-তে এখনো আমাদের লেখাই আছে কিনা মিলিয়ে দেখা হয়, পরে মার্চেন্ট বদলে থাকলে ছোঁয়া হয় না।
 * SEO Alt Tags-এর (seo-alt.server.ts) মতো একই ধাঁচ।
 */
export const TITLE_MAX = 70;
export const DESCRIPTION_MAX = 160;
const PER_STEP = 25;
const UNDO_PER_STEP = 25;
const STEP_DELAY_MS = 1_500;
const NEW_WINDOW_MS = 15 * 60_000;
const NEW_DELAY_MS = 60_000;

type Templates = Pick<
  ReturnType<typeof seoMetaTemplates.settings.parse>,
  "productTitle" | "productDescription" | "collectionTitle" | "collectionDescription"
>;

type Kind = "product" | "collection";
type Field = "title" | "description";

interface Resource {
  id: string;
  title: string;
  vendor?: string | null;
  productType?: string | null;
  description: string;
  seo: { title: string | null; description: string | null };
}

/** একটা প্রোডাক্ট বা কালেকশনের জন্য টেমপ্লেট থেকে টাইটেল আর বর্ণনা (শব্দের মাঝে কাটা হয় না) */
export function renderMeta(
  kind: Kind,
  templates: Templates,
  resource: Pick<Resource, "title" | "vendor" | "productType" | "description">,
  shopName: string,
): Record<Field, string> {
  const description = resource.description.replace(/\s+/g, " ").trim();
  const values =
    kind === "product"
      ? {
          product: resource.title,
          vendor: resource.vendor ?? "",
          type: resource.productType ?? "",
          shop: shopName,
          description,
        }
      : { collection: resource.title, shop: shopName, description };
  const title = kind === "product" ? templates.productTitle : templates.collectionTitle;
  const text = kind === "product" ? templates.productDescription : templates.collectionDescription;
  return {
    title: clip(renderTemplate(title, values, 1_000), TITLE_MAX),
    description: clip(renderTemplate(text, values, 5_000), DESCRIPTION_MAX),
  };
}

const FIELDS = `id title description(truncateAt: 400) seo { title description }`;

const PRODUCTS_QUERY = `#graphql
  query MetaProducts($first: Int!, $after: String, $query: String) {
    shop { name }
    products(first: $first, after: $after, query: $query, sortKey: ID) {
      nodes { ${FIELDS} vendor productType }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const COLLECTIONS_QUERY = `#graphql
  query MetaCollections($first: Int!, $after: String) {
    shop { name }
    collections(first: $first, after: $after, sortKey: ID) {
      nodes { ${FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const CURRENT_QUERY = `#graphql
  query MetaCurrent($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id seo { title description } }
      ... on Collection { id seo { title description } }
    }
  }`;

const PRODUCT_UPDATE = `#graphql
  mutation MetaProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) { product { id } userErrors { field message } }
  }`;

const COLLECTION_UPDATE = `#graphql
  mutation MetaCollection($input: CollectionInput!) {
    collectionUpdate(input: $input) { collection { id } userErrors { field message } }
  }`;

type Seo = { title: string; description: string };

/** Shopify-তে SEO লেখে (দুটো ঘরই পাঠানো হয়, যাতে অন্যটা মুছে না যায়); সফল হলে true */
async function writeSeo(admin: GraphqlClient, id: string, seo: Seo): Promise<boolean> {
  if (id.includes("/Collection/")) {
    const data = await gql<{ collectionUpdate: { userErrors: unknown[] } | null }>(
      admin,
      COLLECTION_UPDATE,
      { input: { id, seo } },
    );
    return (data.collectionUpdate?.userErrors.length ?? 1) === 0;
  }
  const data = await gql<{ productUpdate: { userErrors: unknown[] } | null }>(
    admin,
    PRODUCT_UPDATE,
    { product: { id, seo } },
  );
  return (data.productUpdate?.userErrors.length ?? 1) === 0;
}

export interface FillResult {
  scanned: number;
  updated: number;
  next: string | null;
}

/** এক পাতা প্রোডাক্ট বা কালেকশন দেখে ফাঁকা SEO ঘর ভরে */
export async function fillPage(
  admin: GraphqlClient,
  shopId: string,
  kind: Kind,
  templates: Templates,
  options: { cursor: string | null; query?: string },
): Promise<FillResult> {
  const data =
    kind === "product"
      ? await gql<{
          shop: { name: string };
          products: { nodes: Resource[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
        }>(admin, PRODUCTS_QUERY, {
          first: PER_STEP,
          after: options.cursor,
          query: options.query ?? null,
        }).then((d) => ({ shop: d.shop, list: d.products }))
      : await gql<{
          shop: { name: string };
          collections: {
            nodes: Resource[];
            pageInfo: { hasNextPage: boolean; endCursor: string };
          };
        }>(admin, COLLECTIONS_QUERY, { first: PER_STEP, after: options.cursor }).then((d) => ({
          shop: d.shop,
          list: d.collections,
        }));

  let updated = 0;
  for (const resource of data.list.nodes) {
    const current = {
      title: resource.seo.title ?? "",
      description: resource.seo.description ?? "",
    };
    const made = renderMeta(kind, templates, resource, data.shop.name);
    const fill = (["title", "description"] as const).filter(
      (field) => !current[field].trim() && made[field],
    );
    if (fill.length === 0) continue;
    const next: Seo = { ...current };
    for (const field of fill) next[field] = made[field];
    // আগে নথি, পরে Shopify: মাঝপথে থামলেও "কী বসিয়েছি" হারায় না
    for (const field of fill) {
      await db.seoMetaChange.upsert({
        where: { shopId_resourceId_field: { shopId, resourceId: resource.id, field } },
        create: { shopId, resourceId: resource.id, field, newValue: next[field] },
        update: { newValue: next[field] },
      });
    }
    if (await writeSeo(admin, resource.id, next)) {
      updated++;
    } else {
      await db.seoMetaChange.deleteMany({
        where: { shopId, resourceId: resource.id, field: { in: [...fill] } },
      });
    }
  }
  const { hasNextPage, endCursor } = data.list.pageInfo;
  return { scanned: data.list.nodes.length, updated, next: hasNextPage ? endCursor : null };
}

export interface UndoResult {
  restored: number;
  kept: number;
  next: string | null;
}

/** আমাদের বসানো লেখার এক পাতা আবার ফাঁকা করে (মার্চেন্ট পরে বদলে থাকলে রেখে দেয়) */
export async function undoPage(
  admin: GraphqlClient,
  shopId: string,
  afterId: string | null,
): Promise<UndoResult> {
  const rows = await db.seoMetaChange.findMany({
    where: { shopId, ...(afterId ? { id: { gt: afterId } } : {}) },
    orderBy: { id: "asc" },
    take: UNDO_PER_STEP,
  });
  if (rows.length === 0) return { restored: 0, kept: 0, next: null };
  const ids = [...new Set(rows.map((row) => row.resourceId))];
  const data = await gql<{
    nodes: Array<{
      id?: string;
      seo?: { title: string | null; description: string | null };
    } | null>;
  }>(admin, CURRENT_QUERY, { ids });
  const current = new Map<string, Seo>();
  for (const node of data.nodes) {
    if (node?.id && node.seo) {
      current.set(node.id, {
        title: node.seo.title ?? "",
        description: node.seo.description ?? "",
      });
    }
  }
  let restored = 0;
  let kept = 0;
  const clear: string[] = [];
  for (const id of ids) {
    const mine = rows.filter((row) => row.resourceId === id);
    const now = current.get(id);
    if (!now) {
      // প্রোডাক্ট বা কালেকশন মুছে গেছে
      kept += mine.length;
      clear.push(...mine.map((row) => row.id));
      continue;
    }
    const ours = mine.filter((row) => now[row.field as Field] === row.newValue);
    kept += mine.length - ours.length;
    if (ours.length === 0) {
      clear.push(...mine.map((row) => row.id));
      continue;
    }
    const next: Seo = { ...now };
    for (const row of ours) next[row.field as Field] = "";
    if (await writeSeo(admin, id, next)) {
      restored += ours.length;
      clear.push(...mine.map((row) => row.id));
    } else {
      // ফেরানো যায়নি: নথি থাকে, পরে আবার চেষ্টা করা যায়
      clear.push(...mine.filter((row) => !ours.includes(row)).map((row) => row.id));
    }
  }
  if (clear.length > 0) await db.seoMetaChange.deleteMany({ where: { shopId, id: { in: clear } } });
  return {
    restored,
    kept,
    next: rows.length === UNDO_PER_STEP ? (rows[rows.length - 1]?.id ?? null) : null,
  };
}

/* ------------------------------------------------------------------ */
/* ব্যাকগ্রাউন্ড কাজ                                                    */
/* ------------------------------------------------------------------ */

interface FillPayload {
  kind?: Kind;
  cursor?: string | null;
  scanned?: number;
  updated?: number;
  since?: string;
}

async function runFill(job: JobContext): Promise<JobResult> {
  const shop = await db.shop.findUnique({ where: { id: job.shopId } });
  if (!shop || shop.uninstalledAt) return;
  const settings = await enabledSettings(shop, seoMetaTemplates);
  if (!settings) return;
  const payload = job.payload as FillPayload;
  const auto = job.kind === "meta-new";
  if (auto && (!settings.autoFillNew || !payload.since)) return;
  const kind: Kind = payload.kind ?? "product";
  const { cursor = null, scanned = 0, updated = 0 } = payload;
  const page = await fillPage(await offlineAdmin(shop.domain), shop.id, kind, settings, {
    cursor,
    ...(auto ? { query: `updated_at:>='${payload.since}'` } : {}),
  });
  const progress = { scanned: scanned + page.scanned, updated: updated + page.updated };
  // প্রোডাক্ট শেষ হলে কালেকশন (নতুন প্রোডাক্টের স্বয়ংক্রিয় কাজে শুধু প্রোডাক্ট)
  const nextKind = page.next ? kind : kind === "product" && !auto ? "collection" : null;
  if (!nextKind) return { progress };
  return {
    again: true,
    payload: {
      ...(payload.since ? { since: payload.since } : {}),
      kind: nextKind,
      cursor: page.next,
      ...progress,
    },
    progress,
    delayMs: STEP_DELAY_MS,
  };
}

registerJob("meta-fill", runFill);
registerJob("meta-new", runFill);

registerJob("meta-undo", async (job) => {
  const shop = await db.shop.findUnique({ where: { id: job.shopId } });
  if (!shop || shop.uninstalledAt) return;
  const {
    afterId = null,
    restored = 0,
    kept = 0,
  } = job.payload as { afterId?: string | null; restored?: number; kept?: number };
  const page = await undoPage(await offlineAdmin(shop.domain), shop.id, afterId);
  const progress = { restored: restored + page.restored, kept: kept + page.kept };
  if (!page.next) return { progress };
  return {
    again: true,
    payload: { afterId: page.next, ...progress },
    progress,
    delayMs: STEP_DELAY_MS,
  };
});

const ACTIVE = { in: ["pending", "running"] };

/** "ফাঁকা ঘর ভরো" বা "আগের অবস্থায় ফেরাও": একসাথে একটাই চলে */
export async function startMetaJob(shopId: string, kind: "meta-fill" | "meta-undo") {
  const busy = await db.job.findFirst({
    where: { shopId, kind: { in: ["meta-fill", "meta-undo"] }, status: ACTIVE },
  });
  if (busy) return false;
  await enqueueJob(shopId, kind);
  return true;
}

/**
 * প্রোডাক্ট তৈরি বা বদলের webhook থেকে: সম্প্রতি বদলানো প্রোডাক্টের ফাঁকা SEO ভরার কাজ লাইনে দেয়।
 * একসাথে অনেক webhook এলেও একটাই কাজ অপেক্ষায় থাকে। "ফেরাও" চলার সময় আর তার ঠিক পরে দেওয়া হয় না,
 * নইলে সদ্য ফাঁকা করা ঘর আবার ভরে যেত; "সব ভরো" চলার সময়ও না, কারণ সেটা নিজেই সব প্রোডাক্টে যায়
 * (আর তার প্রতিটা লেখা থেকেও products/update আসে)।
 */
export async function queueNewMeta(shop: ShopRef, now = new Date()): Promise<boolean> {
  const settings = await enabledSettings(shop, seoMetaTemplates);
  if (!settings?.autoFillNew) return false;
  const since = new Date(now.getTime() - NEW_WINDOW_MS);
  const blocking = await db.job.findFirst({
    where: {
      shopId: shop.id,
      OR: [
        { kind: "meta-new", status: "pending" },
        { kind: { in: ["meta-fill", "meta-undo"] }, status: ACTIVE },
        { kind: "meta-undo", finishedAt: { gt: since } },
      ],
    },
  });
  if (blocking) return false;
  await enqueueJob(
    shop.id,
    "meta-new",
    { since: since.toISOString() },
    { runAt: new Date(now.getTime() + NEW_DELAY_MS) },
  );
  return true;
}

/* ------------------------------------------------------------------ */
/* অ্যাডমিন পেজের জন্য                                                 */
/* ------------------------------------------------------------------ */

type JobRow = NonNullable<Awaited<ReturnType<typeof latestJob>>>;
const RECENT_MS = 15 * 60_000;

/** পেজে উদাহরণ দেখাতে: একটা প্রোডাক্ট */
async function sample(admin: GraphqlClient) {
  try {
    const data = await gql<{ shop: { name: string }; products: { nodes: Resource[] } }>(
      admin,
      `#graphql
      query MetaSample {
        shop { name }
        products(first: 1, sortKey: ID) { nodes { ${FIELDS} vendor productType } }
      }`,
    );
    const product = data.products.nodes[0];
    return product ? { product, shopName: data.shop.name } : null;
  } catch {
    return null;
  }
}

/** /app/seo পেজের "SEO টেমপ্লেট" অংশের তথ্য */
export async function metaOverview(
  admin: GraphqlClient,
  shop: { id: string; plan: string | null },
  now = Date.now(),
) {
  const plan = shop.plan === "starter" || shop.plan === "professional" ? shop.plan : null;
  const [row, written, fill, undo, example] = await Promise.all([
    db.toolSetting.findUnique({
      where: { shopId_toolId: { shopId: shop.id, toolId: seoMetaTemplates.id } },
    }),
    db.seoMetaChange.count({ where: { shopId: shop.id } }),
    latestJob(shop.id, "meta-fill"),
    latestJob(shop.id, "meta-undo"),
    sample(admin),
  ]);
  const parsed = seoMetaTemplates.settings.safeParse(row?.settings ?? {});
  const settings = parsed.success ? parsed.data : seoMetaTemplates.settings.parse({});
  const latest = [fill, undo]
    .filter((job): job is JobRow => job !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const progress = (latest?.progress ?? {}) as Record<string, number | undefined>;
  return {
    allowed: plan !== null && canUseTool(seoMetaTemplates as unknown as AnyTool, plan),
    enabled: Boolean(row?.enabled),
    autoFillNew: settings.autoFillNew,
    written,
    example: example
      ? {
          name: example.product.title,
          ...renderMeta("product", settings, example.product, example.shopName),
        }
      : null,
    job: latest
      ? {
          kind: latest.kind as "meta-fill" | "meta-undo",
          status: latest.status,
          error: latest.error,
          active: latest.status === "pending" || latest.status === "running",
          recent: Boolean(latest.finishedAt && now - latest.finishedAt.getTime() < RECENT_MS),
          scanned: progress.scanned ?? 0,
          updated: progress.updated ?? 0,
          restored: progress.restored ?? 0,
          kept: progress.kept ?? 0,
        }
      : null,
  };
}
