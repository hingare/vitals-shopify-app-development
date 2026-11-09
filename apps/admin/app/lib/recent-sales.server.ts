import db from "../db.server";
import type { GraphqlClient } from "./tools.server";

/**
 * Recent Sales Notifications-এর তথ্য।
 * পেইড অর্ডার থেকে শুধু প্রোডাক্ট আর সময় রাখা হয়; ক্রেতার নাম, শহর বা ইমেইল কখনো নয়।
 */
export const TOOL_ID = "recent-sales";
const KEEP_PER_SHOP = 50;
const PER_ORDER = 3;

interface OrderPayload {
  line_items?: Array<{ product_id?: number | string | null; title?: string | null }>;
}

/** অর্ডারের প্রোডাক্টগুলো (একই প্রোডাক্ট একবার, অর্ডার প্রতি সর্বোচ্চ ৩টা) */
export function saleItems(payload: OrderPayload): Array<{ productId: string; title: string }> {
  const seen = new Set<string>();
  const items: Array<{ productId: string; title: string }> = [];
  for (const line of payload.line_items ?? []) {
    const productId = line.product_id == null ? "" : String(line.product_id);
    if (!/^\d{1,20}$/.test(productId) || seen.has(productId)) continue;
    seen.add(productId);
    items.push({ productId, title: (line.title ?? "").slice(0, 255) });
    if (items.length === PER_ORDER) break;
  }
  return items;
}

export async function recentSalesEnabled(shopId: string) {
  const row = await db.toolSetting.findUnique({
    where: { shopId_toolId: { shopId, toolId: TOOL_ID } },
    select: { enabled: true },
  });
  return row?.enabled === true;
}

/** অর্ডার webhook থেকে ডাকা হয়। শুধু স্টোরে প্রকাশিত (ACTIVE) প্রোডাক্ট রাখে। */
export async function recordSales(
  admin: GraphqlClient,
  shopId: string,
  payload: OrderPayload,
  now = new Date(),
) {
  const items = saleItems(payload);
  if (items.length === 0) return 0;
  const res = await admin.graphql(
    `#graphql
    query RecentSaleProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id title handle status featuredMedia { preview { image { url } } } }
      }
    }`,
    { variables: { ids: items.map((i) => `gid://shopify/Product/${i.productId}`) } },
  );
  const json = (await res.json()) as {
    data?: {
      nodes?: Array<{
        id?: string;
        title?: string;
        handle?: string;
        status?: string;
        featuredMedia?: { preview?: { image?: { url?: string } | null } | null } | null;
      } | null>;
    };
  };
  const rows = (json.data?.nodes ?? [])
    .filter((n) => n?.id && n.handle && n.status === "ACTIVE")
    .map((n) => ({
      shopId,
      productId: n!.id!.split("/").pop()!,
      title: (n!.title ?? "").slice(0, 255),
      handle: n!.handle!,
      imageUrl: n!.featuredMedia?.preview?.image?.url ?? null,
      soldAt: now,
    }));
  if (rows.length === 0) return 0;
  await db.recentSale.createMany({ data: rows });

  // পুরনো সারি মুছে প্রতি স্টোরে সর্বোচ্চ ৫০টা রাখি
  const old = await db.recentSale.findMany({
    where: { shopId },
    orderBy: { soldAt: "desc" },
    skip: KEEP_PER_SHOP,
    select: { id: true },
  });
  if (old.length > 0)
    await db.recentSale.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  return rows.length;
}

export async function listRecentSales(shopId: string, maxAgeDays: number, now = new Date()) {
  const since = new Date(now.getTime() - maxAgeDays * 86_400_000);
  const rows = await db.recentSale.findMany({
    where: { shopId, soldAt: { gte: since } },
    orderBy: { soldAt: "desc" },
    take: 20,
  });
  return rows.map((r) => ({
    title: r.title,
    url: `/products/${r.handle}`,
    image: r.imageUrl,
    soldAt: r.soldAt.toISOString(),
  }));
}
