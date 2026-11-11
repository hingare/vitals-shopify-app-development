import { seoAltTags } from "@app/tools";
import { canUseTool, type AnyTool } from "@app/tool-sdk";
import db from "../db.server";
import { gql, offlineAdmin } from "./admin-client.server";
import {
  enqueueJob,
  latestJob,
  registerJob,
  type JobContext,
  type JobResult,
} from "./queue.server";
import { enabledSettings, type ShopRef } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * SEO Alt Tags: প্রোডাক্টের যে ছবিতে alt লেখা নেই, সেখানে নিয়ম অনুযায়ী লেখা বসায়।
 * - মার্চেন্টের নিজের লেখা alt কখনো বদলায় না, শুধু ফাঁকা alt ভরা হয়।
 * - কোন ছবিতে কী বসানো হলো তা লেখা থাকে (AltTextChange), তাই এক ক্লিকে আগের অবস্থায় ফেরানো যায়।
 *   ফেরানোর সময় Shopify-তে এখনকার alt মিলিয়ে দেখা হয়: মার্চেন্ট পরে নিজে বদলে থাকলে সেটা ছোঁয়া হয় না।
 */
export const ALT_MAX = 512;
const PRODUCTS_PER_STEP = 10;
const MEDIA_PER_PRODUCT = 50;
const UPDATE_CHUNK = 25;
const UNDO_PER_STEP = 50;
/** এক ধাপ থেকে পরের ধাপের ফাঁক, যাতে স্টোরের API সীমায় চাপ না পড়ে */
const STEP_DELAY_MS = 1_500;
/** নতুন ছবি: webhook আসার কত আগে পর্যন্ত বদলানো প্রোডাক্ট দেখা হবে */
const NEW_WINDOW_MS = 15 * 60_000;
/** ছবি আপলোডের পর Shopify-র প্রসেস শেষ হতে একটু সময় লাগে */
const NEW_DELAY_MS = 60_000;

export interface AltContext {
  product: string;
  vendor: string;
  type: string;
  shop: string;
}

const VARIABLE = /(\{[a-zA-Z_]+\})/;
const GLUE = /^[\s\-–—|,·•:;/]+$/;

/**
 * নিয়ম থেকে alt লেখা বানায়: {product}, {vendor}, {type}, {shop}।
 * কোনো মান ফাঁকা হলে (যেমন vendor নেই) তার পাশের বিভাজকও বাদ যায়: "Shirt - - Shop" নয়, "Shirt - Shop"।
 * অচেনা {নাম} ফাঁকা ধরা হয়, যাতে বন্ধনীসহ লেখা কখনো ছবির alt-এ না যায়।
 * মানের ভেতরের লেখা (যেমন "T-Shirt") কখনো বদলায় না।
 */
export function renderAlt(template: string, context: AltContext): string {
  const values = context as unknown as Record<string, string | undefined>;
  const parts: Array<{ text: string; glue: boolean }> = [];
  let dropNextGlue = false;
  for (const piece of template.split(VARIABLE)) {
    if (!piece) continue;
    if (VARIABLE.test(piece)) {
      const name = piece.slice(1, -1);
      const value = (Object.hasOwn(values, name) ? (values[name] ?? "") : "").trim();
      if (value) {
        parts.push({ text: value, glue: false });
        dropNextGlue = false;
      } else if (parts[parts.length - 1]?.glue) {
        // ফাঁকা মানের আগের বিভাজক বাদ
        parts.pop();
      } else {
        // আগে বিভাজক নেই (শুরুতে): পরেরটা বাদ
        dropNextGlue = true;
      }
      continue;
    }
    const glue = GLUE.test(piece);
    if (glue && dropNextGlue) {
      dropNextGlue = false;
      continue;
    }
    dropNextGlue = false;
    parts.push({ text: piece, glue });
  }
  while (parts[0]?.glue) parts.shift();
  while (parts[parts.length - 1]?.glue) parts.pop();
  return parts
    .map((part) => part.text)
    .join("")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ALT_MAX)
    .trim();
}

interface MediaNode {
  id?: string;
  alt?: string | null;
  fileStatus?: string;
  createdAt?: string;
}

interface MediaPage {
  nodes: MediaNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface ProductNode {
  id: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  media: MediaPage;
}

const MEDIA_FIELDS = `nodes { ... on MediaImage { id alt fileStatus createdAt } } pageInfo { hasNextPage endCursor }`;

const PRODUCTS_QUERY = `#graphql
  query AltProducts($first: Int!, $after: String, $query: String, $media: Int!) {
    shop { name }
    products(first: $first, after: $after, query: $query, sortKey: ID) {
      nodes {
        id
        title
        vendor
        productType
        media(first: $media, query: "media_type:IMAGE") { ${MEDIA_FIELDS} }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const MORE_MEDIA_QUERY = `#graphql
  query AltProductMedia($id: ID!, $after: String) {
    product(id: $id) {
      media(first: 100, after: $after, query: "media_type:IMAGE") { ${MEDIA_FIELDS} }
    }
  }`;

const CURRENT_QUERY = `#graphql
  query AltCurrent($ids: [ID!]!) {
    nodes(ids: $ids) { ... on MediaImage { id alt } }
  }`;

const UPDATE_MUTATION = `#graphql
  mutation AltUpdate($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files { id }
      userErrors { field message }
    }
  }`;

interface AltFile {
  id: string;
  alt: string;
}

async function updateFiles(admin: GraphqlClient, files: AltFile[]): Promise<string[]> {
  const data = await gql<{ fileUpdate: { files: Array<{ id: string }> | null } | null }>(
    admin,
    UPDATE_MUTATION,
    { files },
  );
  return (data.fileUpdate?.files ?? []).map((file) => file.id);
}

/** Shopify-তে alt লেখে; যেগুলো সত্যিই বদলেছে তাদের id ফেরত দেয় */
async function writeAlts(admin: GraphqlClient, files: AltFile[]): Promise<Set<string>> {
  const done = new Set<string>();
  for (let i = 0; i < files.length; i += UPDATE_CHUNK) {
    const chunk = files.slice(i, i + UPDATE_CHUNK);
    const ok = await updateFiles(admin, chunk);
    if (ok.length === 0 && chunk.length > 1) {
      // একটা খারাপ ছবির জন্য পুরো ব্যাচ ফেরত এলে একটা একটা করে, যাতে বাকিগুলো আটকে না থাকে
      for (const file of chunk) {
        for (const id of await updateFiles(admin, [file])) done.add(id);
      }
    } else {
      for (const id of ok) done.add(id);
    }
  }
  return done;
}

export interface FillOptions {
  cursor: string | null;
  /** Shopify-র প্রোডাক্ট সার্চ (যেমন সম্প্রতি বদলানো প্রোডাক্ট) */
  query?: string;
  /** শুধু এই সময়ের পরে যোগ হওয়া ছবি (নতুন ছবির স্বয়ংক্রিয় কাজে) */
  createdSince?: Date;
}

export interface FillResult {
  scanned: number;
  updated: number;
  next: string | null;
}

/** প্রোডাক্টের এক পাতা দেখে ফাঁকা alt ভরে */
export async function fillPage(
  admin: GraphqlClient,
  shopId: string,
  template: string,
  options: FillOptions,
): Promise<FillResult> {
  const data = await gql<{
    shop: { name: string };
    products: {
      nodes: ProductNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }>(admin, PRODUCTS_QUERY, {
    first: PRODUCTS_PER_STEP,
    after: options.cursor,
    query: options.query ?? null,
    media: MEDIA_PER_PRODUCT,
  });

  // একই ছবি একাধিক প্রোডাক্টে থাকলে প্রথমটার লেখাই বসে
  const todo = new Map<string, { productId: string; alt: string }>();
  for (const product of data.products.nodes) {
    const alt = renderAlt(template, {
      product: product.title,
      vendor: product.vendor ?? "",
      type: product.productType ?? "",
      shop: data.shop.name,
    });
    if (!alt) continue;
    const images = [...product.media.nodes];
    let page = product.media.pageInfo;
    while (page.hasNextPage) {
      const more = await gql<{ product: { media: MediaPage } | null }>(admin, MORE_MEDIA_QUERY, {
        id: product.id,
        after: page.endCursor,
      });
      if (!more.product) break;
      images.push(...more.product.media.nodes);
      page = more.product.media.pageInfo;
    }
    for (const image of images) {
      // প্রসেস শেষ না হওয়া ছবি Shopify বদলাতে দেয় না; পরের বার ধরা পড়বে
      if (!image.id || image.fileStatus !== "READY" || image.alt?.trim()) continue;
      if (options.createdSince) {
        const created = image.createdAt ? new Date(image.createdAt) : null;
        if (!created || created < options.createdSince) continue;
      }
      if (!todo.has(image.id)) todo.set(image.id, { productId: product.id, alt });
    }
  }

  const ids = [...todo.keys()];
  let updated = 0;
  if (ids.length > 0) {
    // আগে নথি, পরে Shopify: মাঝপথে সার্ভার বন্ধ হলেও "কী বদলেছি" হারায় না
    await db.altTextChange.deleteMany({ where: { shopId, mediaId: { in: ids } } });
    await db.altTextChange.createMany({
      data: ids.map((mediaId) => {
        const item = todo.get(mediaId)!;
        return { shopId, mediaId, productId: item.productId, oldAlt: "", newAlt: item.alt };
      }),
      skipDuplicates: true,
    });
    const done = await writeAlts(
      admin,
      ids.map((id) => ({ id, alt: todo.get(id)!.alt })),
    );
    const failed = ids.filter((id) => !done.has(id));
    if (failed.length > 0) {
      await db.altTextChange.deleteMany({ where: { shopId, mediaId: { in: failed } } });
    }
    updated = done.size;
  }

  const { hasNextPage, endCursor } = data.products.pageInfo;
  return { scanned: data.products.nodes.length, updated, next: hasNextPage ? endCursor : null };
}

export interface UndoResult {
  restored: number;
  /** মার্চেন্ট পরে নিজে বদলেছেন বা ছবি মুছেছেন: ছোঁয়া হয়নি */
  kept: number;
  next: string | null;
}

/** আমাদের বসানো alt-এর এক পাতা আগের অবস্থায় ফেরায় */
export async function undoPage(
  admin: GraphqlClient,
  shopId: string,
  afterId: string | null,
): Promise<UndoResult> {
  const rows = await db.altTextChange.findMany({
    where: { shopId, ...(afterId ? { id: { gt: afterId } } : {}) },
    orderBy: { id: "asc" },
    take: UNDO_PER_STEP,
  });
  if (rows.length === 0) return { restored: 0, kept: 0, next: null };

  const data = await gql<{ nodes: Array<{ id?: string; alt?: string | null } | null> }>(
    admin,
    CURRENT_QUERY,
    { ids: rows.map((row) => row.mediaId) },
  );
  const current = new Map<string, string>();
  for (const node of data.nodes) if (node?.id) current.set(node.id, node.alt ?? "");

  // এখনো আমাদের বসানো লেখাই আছে এমন ছবিই শুধু ফেরানো হয়
  const ours = rows.filter((row) => current.get(row.mediaId) === row.newAlt);
  const done = await writeAlts(
    admin,
    ours.map((row) => ({ id: row.mediaId, alt: row.oldAlt })),
  );
  // ফেরানো যায়নি এমন নথি থেকে যায়, যাতে পরে আবার চেষ্টা করা যায়
  const stuck = new Set(ours.filter((row) => !done.has(row.mediaId)).map((row) => row.id));
  const clear = rows.filter((row) => !stuck.has(row.id)).map((row) => row.id);
  if (clear.length > 0) {
    await db.altTextChange.deleteMany({ where: { shopId, id: { in: clear } } });
  }
  return {
    restored: done.size,
    kept: rows.length - ours.length,
    next: rows.length === UNDO_PER_STEP ? (rows[rows.length - 1]?.id ?? null) : null,
  };
}

/* ------------------------------------------------------------------ */
/* ব্যাকগ্রাউন্ড কাজ                                                    */
/* ------------------------------------------------------------------ */

interface FillPayload {
  cursor?: string | null;
  scanned?: number;
  updated?: number;
  /** "alt-new" কাজে: এই সময়ের পরে বদলানো প্রোডাক্টের নতুন ছবি */
  since?: string;
}

async function runFill(job: JobContext): Promise<JobResult> {
  const shop = await db.shop.findUnique({ where: { id: job.shopId } });
  if (!shop || shop.uninstalledAt) return;
  // টুল বন্ধ করলে চলমান কাজও থামে
  const settings = await enabledSettings(shop, seoAltTags);
  if (!settings) return;
  const { cursor = null, scanned = 0, updated = 0, since } = job.payload as FillPayload;
  const auto = job.kind === "alt-new";
  if (auto && (!settings.autoNew || !since)) return;

  const page = await fillPage(await offlineAdmin(shop.domain), shop.id, settings.altTemplate, {
    cursor,
    ...(auto && since ? { query: `updated_at:>='${since}'`, createdSince: new Date(since) } : {}),
  });
  const progress = { scanned: scanned + page.scanned, updated: updated + page.updated };
  if (!page.next) return { progress };
  return {
    again: true,
    payload: { ...(since ? { since } : {}), cursor: page.next, ...progress },
    progress,
    delayMs: STEP_DELAY_MS,
  };
}

registerJob("alt-fill", runFill);
registerJob("alt-new", runFill);

registerJob("alt-undo", async (job) => {
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

/** "ফাঁকা alt ভরো" বা "আগের অবস্থায় ফেরাও": একসাথে একটাই চলে */
export async function startAltJob(shopId: string, kind: "alt-fill" | "alt-undo") {
  const busy = await db.job.findFirst({
    where: { shopId, kind: { in: ["alt-fill", "alt-undo"] }, status: ACTIVE },
  });
  if (busy) return false;
  await enqueueJob(shopId, kind);
  return true;
}

export interface ProductImagesPayload {
  images?: Array<{ alt?: string | null }> | null;
  media?: Array<{ alt?: string | null; media_content_type?: string | null }> | null;
}

/** products/update-এর payload-এ alt ছাড়া ছবি আছে কিনা (না থাকলে কাজ লাইনে দেওয়ার দরকার নেই) */
export function hasImageWithoutAlt(payload: ProductImagesPayload): boolean {
  const lists: Array<Array<{ alt?: string | null }>> = [];
  if (Array.isArray(payload.images)) lists.push(payload.images);
  if (Array.isArray(payload.media)) {
    lists.push(
      payload.media.filter((m) => !m.media_content_type || m.media_content_type === "IMAGE"),
    );
  }
  // ছবির তালিকাই না এলে নিশ্চিত হওয়া যায় না: তখন দেখে নেওয়াই নিরাপদ
  if (lists.length === 0) return true;
  return lists.some((list) => list.some((image) => !image.alt?.trim()));
}

/**
 * প্রোডাক্ট তৈরি বা বদলের webhook থেকে: নতুন ছবিতে alt বসানোর কাজ লাইনে দেয়।
 * অনেক webhook একসাথে এলেও একটাই কাজ অপেক্ষায় থাকে। "আগের অবস্থায় ফেরাও" চলার সময় আর তার
 * ঠিক পরে কাজ দেওয়া হয় না, নইলে সদ্য মোছা লেখা আবার বসে যেত।
 */
export async function queueNewImages(
  shop: ShopRef,
  payload: ProductImagesPayload,
  now = new Date(),
): Promise<boolean> {
  if (!hasImageWithoutAlt(payload)) return false;
  const settings = await enabledSettings(shop, seoAltTags);
  if (!settings?.autoNew) return false;
  const since = new Date(now.getTime() - NEW_WINDOW_MS);
  const blocking = await db.job.findFirst({
    where: {
      shopId: shop.id,
      OR: [
        { kind: "alt-new", status: "pending" },
        { kind: "alt-undo", status: ACTIVE },
        { kind: "alt-undo", finishedAt: { gt: since } },
      ],
    },
  });
  if (blocking) return false;
  await enqueueJob(
    shop.id,
    "alt-new",
    { since: since.toISOString() },
    { runAt: new Date(now.getTime() + NEW_DELAY_MS) },
  );
  return true;
}

/* ------------------------------------------------------------------ */
/* অ্যাডমিন পেজের জন্য                                                 */
/* ------------------------------------------------------------------ */

/** পেজে উদাহরণ দেখাতে: স্টোরের নাম আর একটা প্রোডাক্ট */
async function sampleContext(admin: GraphqlClient): Promise<AltContext | null> {
  try {
    const data = await gql<{
      shop: { name: string };
      products: {
        nodes: Array<{ title: string; vendor: string | null; productType: string | null }>;
      };
    }>(
      admin,
      `#graphql
      query AltSample {
        shop { name }
        products(first: 1, sortKey: ID) { nodes { title vendor productType } }
      }`,
    );
    const product = data.products.nodes[0];
    if (!product) return null;
    return {
      product: product.title,
      vendor: product.vendor ?? "",
      type: product.productType ?? "",
      shop: data.shop.name,
    };
  } catch {
    return null;
  }
}

type JobRow = NonNullable<Awaited<ReturnType<typeof latestJob>>>;

/** শেষ হওয়া কাজের খবর কিছুক্ষণই দেখানো হয়, পুরোনো খবর পেজে পড়ে থাকে না */
const RECENT_MS = 15 * 60_000;

function jobView(job: JobRow, now: number) {
  const progress = (job.progress ?? {}) as Record<string, number | undefined>;
  return {
    kind: job.kind as "alt-fill" | "alt-undo",
    status: job.status,
    error: job.error,
    active: job.status === "pending" || job.status === "running",
    recent: Boolean(job.finishedAt && now - job.finishedAt.getTime() < RECENT_MS),
    scanned: progress.scanned ?? 0,
    updated: progress.updated ?? 0,
    restored: progress.restored ?? 0,
    kept: progress.kept ?? 0,
  };
}

/** /app/seo-alt পেজের সব তথ্য */
export async function altOverview(
  admin: GraphqlClient,
  shop: { id: string; plan: string | null },
  now = Date.now(),
) {
  const plan = shop.plan === "starter" || shop.plan === "professional" ? shop.plan : null;
  const [row, written, fill, undo, sample] = await Promise.all([
    db.toolSetting.findUnique({
      where: { shopId_toolId: { shopId: shop.id, toolId: seoAltTags.id } },
    }),
    db.altTextChange.count({ where: { shopId: shop.id } }),
    latestJob(shop.id, "alt-fill"),
    latestJob(shop.id, "alt-undo"),
    sampleContext(admin),
  ]);
  const parsed = seoAltTags.settings.safeParse(row?.settings ?? {});
  const settings = parsed.success ? parsed.data : seoAltTags.settings.parse({});
  // দুটোর মধ্যে যেটা পরে শুরু হয়েছে সেটার খবরই দেখানো হয়
  const latest = [fill, undo]
    .filter((job): job is JobRow => job !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return {
    allowed: plan !== null && canUseTool(seoAltTags as unknown as AnyTool, plan),
    enabled: Boolean(row?.enabled),
    template: settings.altTemplate,
    autoNew: settings.autoNew,
    example: sample ? renderAlt(settings.altTemplate, sample) : null,
    written,
    job: latest ? jobView(latest, now) : null,
  };
}
