import { gql } from "./admin-client.server";
import { cleanEmail } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * Shopify-র customer খোঁজা: ইমেইল দিয়ে, বা id দিয়ে।
 * মার্কেটিং ইমেইলের সম্মতির আসল জায়গা Shopify-র customer, তাই গ্রাহক তালিকা আর ইমেইল পাঠানোর কোড
 * দুটোই দরকার হলে এখান থেকে জিজ্ঞেস করে।
 * ক্রেতার নাম-ইমেইল পড়তে Partner Dashboard-এ "Protected customer data" (Name, Email) লাগে; না থাকলে
 * Shopify ত্রুটি দেয় আর এই ফাংশনগুলো ছোড়ে।
 */
export interface ShopifyCustomer {
  /** gid://shopify/Customer/… */
  id: string;
  /** SUBSCRIBED | UNSUBSCRIBED | NOT_SUBSCRIBED | PENDING | INVALID */
  marketingState: string | null;
}

const quote = (value: string) => `"${value.replace(/["\\]/g, "")}"`;

/**
 * এই ইমেইলের Shopify customer; এমন কেউ না থাকলে null।
 * Shopify-র খোঁজ কাছাকাছি ঠিকানাও ফেরত দিতে পারে, তাই ঠিকানা হুবহু মিললে তবেই ধরা হয়:
 * ভুল মানুষকে ধরলে তাঁর সম্মতি বদলে যেত, বা তাঁর তথ্য অন্য ক্রেতার হাতে যেত।
 */
export async function findCustomer(
  admin: GraphqlClient,
  email: string,
): Promise<ShopifyCustomer | null> {
  const wanted = email.trim().toLowerCase();
  const found = await gql<{
    customers: {
      nodes: Array<{
        id: string;
        defaultEmailAddress: { emailAddress: string | null; marketingState: string } | null;
      }>;
    };
  }>(
    admin,
    `#graphql
    query CustomerByEmail($query: String!) {
      customers(first: 5, query: $query) {
        nodes { id defaultEmailAddress { emailAddress marketingState } }
      }
    }`,
    { query: `email:${quote(wanted)}` },
  );
  const match = found.customers.nodes.find(
    (node) => node.defaultEmailAddress?.emailAddress?.trim().toLowerCase() === wanted,
  );
  return match
    ? { id: match.id, marketingState: match.defaultEmailAddress?.marketingState ?? null }
    : null;
}

/** এই ইমেইলের Shopify customer-এর সংখ্যা-id (লগইন করা ক্রেতার wishlist এই id-তে রাখা) */
export async function findCustomerId(admin: GraphqlClient, email: string): Promise<string | null> {
  const customer = await findCustomer(admin, email);
  return customer?.id.split("/").pop() ?? null;
}

/** এই ঠিকানার মালিক Shopify-তে মার্কেটিং ইমেইল বন্ধ করেছেন কিনা (customer না থাকলে false) */
export async function hasOptedOut(admin: GraphqlClient, email: string): Promise<boolean> {
  const customer = await findCustomer(admin, email);
  return customer?.marketingState === "UNSUBSCRIBED";
}

export interface CustomerDetails {
  /** ছোট হাতের অক্ষরে; customer-এর ইমেইল না থাকলে null */
  email: string | null;
  firstName: string | null;
  /** ছোট হাতের অক্ষরে */
  tags: string[];
  marketingState: string | null;
  /** সম্মতি শেষ কবে বদলেছে (Shopify-র হিসাবে) */
  marketingUpdatedAt: Date | null;
}

/**
 * সংখ্যা-id দিয়ে এক customer-এর নাম, ট্যাগ আর সম্মতির এখনকার অবস্থা; customer না থাকলে null।
 * Shopify-র customer webhook-এ এগুলো আর আসে না (2025-01 থেকে), তাই দরকার হলে আলাদা করে জানতে হয়।
 */
export async function customerDetails(
  admin: GraphqlClient,
  customerId: string,
): Promise<CustomerDetails | null> {
  const data = await gql<{
    customer: {
      firstName: string | null;
      tags: string[];
      defaultEmailAddress: {
        emailAddress: string;
        marketingState: string;
        marketingUpdatedAt: string | null;
      } | null;
    } | null;
  }>(
    admin,
    `#graphql
    query CustomerConsent($id: ID!) {
      customer(id: $id) {
        firstName
        tags
        defaultEmailAddress { emailAddress marketingState marketingUpdatedAt }
      }
    }`,
    { id: `gid://shopify/Customer/${customerId}` },
  );
  const customer = data.customer;
  if (!customer) return null;
  const address = customer.defaultEmailAddress;
  const stamp = address?.marketingUpdatedAt ? new Date(address.marketingUpdatedAt) : null;
  return {
    email: cleanEmail(address?.emailAddress),
    firstName: customer.firstName,
    tags: customer.tags.map((tag) => tag.trim().toLowerCase()),
    marketingState: address?.marketingState ?? null,
    marketingUpdatedAt: stamp && !Number.isNaN(stamp.getTime()) ? stamp : null,
  };
}
