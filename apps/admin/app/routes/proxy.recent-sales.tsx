import type { LoaderFunctionArgs } from "react-router";
import { recentSales } from "@app/tools";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { listRecentSales, TOOL_ID } from "../lib/recent-sales.server";

/** স্টোরফ্রন্টের Recent Sales উইজেট এখান থেকে সাম্প্রতিক বিক্রি নেয় (/apps/app-tools/recent-sales) */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" };
  const shop = session?.shop ? await db.shop.findUnique({ where: { domain: session.shop } }) : null;
  if (!shop || shop.uninstalledAt) return new Response('{"sales":[]}', { headers });
  const row = await db.toolSetting.findUnique({
    where: { shopId_toolId: { shopId: shop.id, toolId: TOOL_ID } },
  });
  if (!row?.enabled) return new Response('{"sales":[]}', { headers });
  const parsed = recentSales.settings.safeParse(row.settings ?? {});
  const maxAgeDays = parsed.success ? parsed.data.maxAgeDays : 7;
  return new Response(JSON.stringify({ sales: await listRecentSales(shop.id, maxAgeDays) }), {
    headers,
  });
};
