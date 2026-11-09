import { registry } from "@app/tools";
import { Prisma } from "@prisma/client";
import db from "../db.server";

export const EVENT_TYPES = ["view", "click", "add_to_cart"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const ATTRIBUTION_ATTRIBUTE = "_app_tools";
const MAX_EVENTS = 50;

export interface ToolEvent {
  toolId: string;
  type: EventType;
}

/** স্টোরফ্রন্ট থেকে আসা ইভেন্ট যাচাই করে; অচেনা টুল বা টাইপ বাদ দেয়। */
export function parseEvents(body: unknown): ToolEvent[] {
  const list = (body as { events?: unknown })?.events;
  if (!Array.isArray(list)) return [];
  const events: ToolEvent[] = [];
  for (const item of list.slice(0, MAX_EVENTS)) {
    const { toolId, type } = (item ?? {}) as { toolId?: unknown; type?: unknown };
    if (
      typeof toolId === "string" &&
      registry.get(toolId) &&
      typeof type === "string" &&
      (EVENT_TYPES as readonly string[]).includes(type)
    ) {
      events.push({ toolId, type: type as EventType });
    }
  }
  return events;
}

export function utcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** একই টুলের ইভেন্ট গুনে এক কোয়েরিতে যোগ করে */
export async function recordEvents(shopId: string, events: ToolEvent[], now = new Date()) {
  const counts = new Map<string, { views: number; clicks: number; addToCarts: number }>();
  for (const e of events) {
    const c = counts.get(e.toolId) ?? { views: 0, clicks: 0, addToCarts: 0 };
    if (e.type === "view") c.views++;
    if (e.type === "click") c.clicks++;
    if (e.type === "add_to_cart") c.addToCarts++;
    counts.set(e.toolId, c);
  }
  const date = utcDay(now);
  await Promise.all(
    [...counts].map(([toolId, c]) =>
      db.dailyToolStat.upsert({
        where: { shopId_toolId_date: { shopId, toolId, date } },
        create: { shopId, toolId, date, ...c },
        update: {
          views: { increment: c.views },
          clicks: { increment: c.clicks },
          addToCarts: { increment: c.addToCarts },
        },
      }),
    ),
  );
}

interface OrderPayload {
  total_price?: string;
  note_attributes?: Array<{ name?: string; value?: string }>;
}

/** অর্ডারের cart attribute থেকে কোন টুল বিক্রিতে ভূমিকা রেখেছে তা বের করে */
export function parseOrderAttribution(payload: OrderPayload): {
  toolIds: string[];
  revenue: string;
} {
  const attr = payload.note_attributes?.find((a) => a.name === ATTRIBUTION_ATTRIBUTE)?.value ?? "";
  const toolIds = [...new Set(attr.split(",").map((s) => s.trim()))].filter((id) =>
    registry.get(id),
  );
  const revenue = /^\d+(\.\d+)?$/.test(payload.total_price ?? "") ? payload.total_price! : "0";
  return { toolIds, revenue };
}

/**
 * একাধিক টুল থাকলে প্রতিটি টুলকে পুরো অর্ডারের কৃতিত্ব দেওয়া হয় (Vitals-এর মতো),
 * তাই টুলগুলোর আয় যোগ করলে মোট বিক্রির চেয়ে বেশি হতে পারে। ড্যাশবোর্ডে মোট আলাদা দেখানো হয়।
 */
export async function recordOrder(
  shopId: string,
  toolIds: string[],
  revenue: string,
  now = new Date(),
) {
  const date = utcDay(now);
  const amount = new Prisma.Decimal(revenue);
  await Promise.all(
    toolIds.map((toolId) =>
      db.dailyToolStat.upsert({
        where: { shopId_toolId_date: { shopId, toolId, date } },
        create: { shopId, toolId, date, orders: 1, revenue: amount },
        update: { orders: { increment: 1 }, revenue: { increment: amount } },
      }),
    ),
  );
}

export async function getToolStats(shopId: string, days = 30) {
  const since = utcDay(new Date(Date.now() - (days - 1) * 86_400_000));
  const rows = await db.dailyToolStat.groupBy({
    by: ["toolId"],
    where: { shopId, date: { gte: since } },
    _sum: { views: true, clicks: true, addToCarts: true, orders: true, revenue: true },
  });
  return rows.map((r) => ({
    toolId: r.toolId,
    views: r._sum.views ?? 0,
    clicks: r._sum.clicks ?? 0,
    addToCarts: r._sum.addToCarts ?? 0,
    orders: r._sum.orders ?? 0,
    revenue: Number(r._sum.revenue ?? 0),
  }));
}
