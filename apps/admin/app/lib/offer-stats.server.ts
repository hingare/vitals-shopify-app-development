import { Prisma } from "@prisma/client";
import db from "../db.server";
import { utcDay } from "./analytics.server";
import { AB_ATTRIBUTE, type OfferType } from "./offers";
import { offerLabel } from "./offers.server";

interface OrderPayload {
  total_price?: string;
  note_attributes?: Array<{ name?: string; value?: string }>;
  discount_applications?: Array<{ type?: string; title?: string; description?: string }>;
  line_items?: Array<{
    discount_allocations?: Array<{ amount?: string; discount_application_index?: number }>;
  }>;
}

const money = (v: string | undefined) => (/^\d+(\.\d+)?$/.test(v ?? "") ? Number(v) : 0);

/**
 * অর্ডারের কোন ছাড় কোন অফারের তা অফারের লেবেল দিয়ে মেলায়
 * (Shopify অর্ডারে automatic আর post-purchase ছাড়ের লেবেলই title হিসেবে রাখে)।
 * ফলাফল: অফার id → সেই অফারে দেওয়া ছাড়; সাথে অর্ডারের মোট আর A/B গ্রুপ।
 */
export function parseOfferAttribution(
  payload: OrderPayload,
  offers: Array<{ id: string; type: string; config: unknown }>,
) {
  const byLabel = new Map<string, string>();
  for (const o of offers) {
    const message = (o.config as { message?: string } | null)?.message;
    byLabel.set(offerLabel(o.type as OfferType, message).toLowerCase(), o.id);
  }
  const apps = payload.discount_applications ?? [];
  const offerByIndex = apps.map((a) => {
    // কোডের title হলো কোড নিজেই; automatic আর post-purchase-এর ছাড়ে title আমাদের লেবেল
    if (a.type === "discount_code") return undefined;
    return (
      byLabel.get((a.title ?? "").trim().toLowerCase()) ??
      byLabel.get((a.description ?? "").trim().toLowerCase())
    );
  });
  const discounts = new Map<string, number>();
  for (const item of payload.line_items ?? []) {
    for (const alloc of item.discount_allocations ?? []) {
      const offerId = offerByIndex[alloc.discount_application_index ?? -1];
      if (!offerId) continue;
      discounts.set(offerId, (discounts.get(offerId) ?? 0) + money(alloc.amount));
    }
  }
  const group = payload.note_attributes?.find((a) => a.name === AB_ATTRIBUTE)?.value ?? "";
  return {
    discounts,
    revenue: money(payload.total_price),
    abGroup: group === "A" || group === "B" ? group : null,
  };
}

const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

export async function recordOfferOrder(shopId: string, payload: OrderPayload, now = new Date()) {
  const offers = await db.offer.findMany({
    where: { shopId },
    select: { id: true, type: true, config: true },
  });
  const { discounts, revenue, abGroup } = parseOfferAttribution(payload, offers);
  const date = utcDay(now);
  await Promise.all([
    ...[...discounts].map(([offerId, discount]) =>
      db.offerDailyStat.upsert({
        where: { shopId_offerId_date: { shopId, offerId, date } },
        create: {
          shopId,
          offerId,
          date,
          orders: 1,
          revenue: dec(revenue),
          discount: dec(discount),
        },
        update: {
          orders: { increment: 1 },
          revenue: { increment: dec(revenue) },
          discount: { increment: dec(discount) },
        },
      }),
    ),
    ...(abGroup
      ? [
          db.dailyAbStat.upsert({
            where: { shopId_group_date: { shopId, group: abGroup, date } },
            create: { shopId, group: abGroup, date, orders: 1, revenue: dec(revenue) },
            update: { orders: { increment: 1 }, revenue: { increment: dec(revenue) } },
          }),
        ]
      : []),
  ]);
}

/** অফার পেজের রিপোর্ট: প্রতিটি অফারের অর্ডার, বিক্রি, ছাড়, AOV আর A/B গ্রুপের তুলনা */
export async function getOfferReport(shopId: string, days = 30, now = new Date()) {
  const since = utcDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  const [offerRows, abRows] = await Promise.all([
    db.offerDailyStat.groupBy({
      by: ["offerId"],
      where: { shopId, date: { gte: since } },
      _sum: { orders: true, revenue: true, discount: true },
    }),
    db.dailyAbStat.groupBy({
      by: ["group"],
      where: { shopId, date: { gte: since } },
      _sum: { orders: true, revenue: true },
    }),
  ]);
  const aov = (revenue: number, orders: number) => (orders > 0 ? revenue / orders : 0);
  return {
    days,
    offers: Object.fromEntries(
      offerRows.map((r) => {
        const orders = r._sum.orders ?? 0;
        const revenue = Number(r._sum.revenue ?? 0);
        return [
          r.offerId,
          { orders, revenue, discount: Number(r._sum.discount ?? 0), aov: aov(revenue, orders) },
        ];
      }),
    ) as Record<string, { orders: number; revenue: number; discount: number; aov: number }>,
    ab: abRows.map((r) => {
      const orders = r._sum.orders ?? 0;
      const revenue = Number(r._sum.revenue ?? 0);
      return { group: r.group, orders, revenue, aov: aov(revenue, orders) };
    }),
  };
}
