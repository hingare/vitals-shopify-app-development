import type { GraphqlClient } from "./tools.server";

/**
 * ব্যাকগ্রাউন্ড কাজ থেকে স্টোরের Admin API (সেভ করা offline token দিয়ে)।
 * shopify.server দেরিতে আনা হয়, যাতে টেস্টে পুরো Shopify লাইব্রেরি চালু করতে না হয়।
 */
export async function offlineAdmin(shopDomain: string): Promise<GraphqlClient> {
  const { unauthenticated } = await import("../shopify.server");
  const { admin } = await unauthenticated.admin(shopDomain);
  return admin;
}

/** GraphQL উত্তর পড়ে; errors থাকলে ছোড়ে */
export async function gql<T>(
  admin: GraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error("Empty response from Shopify");
  return json.data;
}
