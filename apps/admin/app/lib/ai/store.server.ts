import { gql } from "../admin-client.server";
import { getStoreReport } from "../store-analytics.server";
import type { GraphqlClient } from "../tools.server";

/** দোকানের সারাংশ: মার্কেটিং পরিকল্পনা আর ক্যাম্পেইনের AI এটা দেখে লেখে */
export interface StoreContext {
  name: string;
  description: string;
  currency: string;
  domains: string[];
  primaryUrl: string;
  products: Array<{ title: string; type: string; price: string }>;
  collections: string[];
}

export async function loadStore(admin: GraphqlClient): Promise<StoreContext> {
  const data = await gql<{
    shop: {
      name: string;
      description: string | null;
      currencyCode: string;
      myshopifyDomain: string;
      primaryDomain: { url: string; host: string };
    };
    products: {
      nodes: Array<{
        title: string;
        productType: string;
        priceRangeV2: { minVariantPrice: { amount: string } } | null;
      }>;
    };
    collections: { nodes: Array<{ title: string }> };
  }>(
    admin,
    `#graphql
    query AiStore {
      shop { name description currencyCode myshopifyDomain primaryDomain { url host } }
      products(first: 25, sortKey: UPDATED_AT, reverse: true, query: "status:active") {
        nodes { title productType priceRangeV2 { minVariantPrice { amount } } }
      }
      collections(first: 15, sortKey: UPDATED_AT, reverse: true) { nodes { title } }
    }`,
  );
  return {
    name: data.shop.name,
    description: data.shop.description ?? "",
    currency: data.shop.currencyCode,
    domains: [...new Set([data.shop.primaryDomain.host, data.shop.myshopifyDomain])],
    primaryUrl: data.shop.primaryDomain.url,
    products: data.products.nodes.map((p) => ({
      title: p.title,
      type: p.productType,
      price: p.priceRangeV2?.minVariantPrice.amount ?? "",
    })),
    collections: data.collections.nodes.map((c) => c.title),
  };
}

export async function storeBrief(shopId: string, store: StoreContext): Promise<string> {
  const report = await getStoreReport(shopId, 30);
  const t = report.totals;
  const lines = [
    `Store name: ${store.name}`,
    store.description && `About: ${store.description}`,
    `Currency: ${store.currency}`,
    store.collections.length > 0 && `Collections: ${store.collections.join(", ")}`,
    `Products (newest first): ${store.products
      .map((p) => `${p.title}${p.type ? ` (${p.type})` : ""}${p.price ? ` ${p.price}` : ""}`)
      .join("; ")}`,
    t.visitors > 0 &&
      `Last 30 days: ${t.visitors} visitors, ${t.addToCarts} add to carts, ${t.orders} orders, ${Math.round(t.revenue)} ${store.currency} revenue.`,
    report.sources.length > 0 &&
      `Visitors by source: ${report.sources.map((s) => `${s.name} ${s.visitors}`).join(", ")}`,
  ].filter(Boolean);
  return `<store_data>\n${lines.join("\n")}\n</store_data>`;
}
