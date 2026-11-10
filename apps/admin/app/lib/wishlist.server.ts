import { wishlist } from "@app/tools";
import db from "../db.server";
import { gql } from "./admin-client.server";
import { connectedProviders, queueEvent } from "./integrations.server";
import { enabledSettings, type ShopRef } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * Wishlist। তালিকার মালিক দুই রকম: লগইন করা ক্রেতা ("c:<customer id>", সব ডিভাইসে একই তালিকা)
 * আর অতিথি ("g:<ব্রাউজারে বানানো র‍্যান্ডম id>")। অতিথি লগইন করলে তার তালিকা ক্রেতার তালিকায় মিশে যায়।
 * ক্রেতার id আসে Shopify-র সই করা App Proxy অনুরোধ থেকে, তাই কেউ অন্যের তালিকা দেখতে বা বদলাতে পারে না।
 */
const MAX_ITEMS = 200;
const PRODUCT_ID = /^\d{1,20}$/;
const HANDLE = /^[^\s/?#]{1,255}$/;
const GUEST_ID = /^[A-Za-z0-9_-]{16,64}$/;

export interface WishlistEntry {
  productId: string;
  handle: string;
}

export function ownerKeys(customerId: string | null | undefined, guestId: unknown) {
  return {
    customer: customerId && PRODUCT_ID.test(customerId) ? `c:${customerId}` : null,
    guest: typeof guestId === "string" && GUEST_ID.test(guestId) ? `g:${guestId}` : null,
  };
}

export async function listWishlist(shopId: string, owner: string): Promise<WishlistEntry[]> {
  const rows = await db.wishlistItem.findMany({
    where: { shopId, owner },
    orderBy: { createdAt: "desc" },
    take: MAX_ITEMS,
  });
  return rows.map((row) => ({ productId: row.productId, handle: row.handle }));
}

/** অতিথির জমানো প্রোডাক্ট ক্রেতার তালিকায় নিয়ে আসে (একই প্রোডাক্ট দুবার হয় না) */
export async function mergeGuestList(shopId: string, guest: string, customer: string) {
  const items = await db.wishlistItem.findMany({ where: { shopId, owner: guest } });
  if (items.length === 0) return;
  await db.wishlistItem.createMany({
    data: items.map((item) => ({
      shopId,
      owner: customer,
      productId: item.productId,
      handle: item.handle,
      createdAt: item.createdAt,
    })),
    skipDuplicates: true,
  });
  await db.wishlistItem.deleteMany({ where: { shopId, owner: guest } });
}

export type WishlistChange = "added" | "removed" | "exists" | "missing" | "invalid" | "full";

export async function changeWishlist(
  shopId: string,
  owner: string,
  action: unknown,
  input: { productId: unknown; handle: unknown },
): Promise<WishlistChange> {
  const productId = String(input.productId ?? "");
  if (!PRODUCT_ID.test(productId)) return "invalid";
  if (action === "remove") {
    const { count } = await db.wishlistItem.deleteMany({ where: { shopId, owner, productId } });
    return count > 0 ? "removed" : "missing";
  }
  if (action !== "add") return "invalid";
  const handle = typeof input.handle === "string" ? input.handle.trim() : "";
  if (!HANDLE.test(handle)) return "invalid";
  if ((await db.wishlistItem.count({ where: { shopId, owner } })) >= MAX_ITEMS) return "full";
  const { count } = await db.wishlistItem.createMany({
    data: [{ shopId, owner, productId, handle }],
    skipDuplicates: true,
  });
  return count > 0 ? "added" : "exists";
}

/**
 * "Wishlist added" ইভেন্ট সংযুক্ত ইমেইল টুলে পাঠায়। শুধু লগইন করা ক্রেতার জন্য
 * (অতিথির ইমেইল আমরা জানি না), আর কোনো ইমেইল টুল সংযুক্ত না থাকলে Shopify-কে কিছু জিজ্ঞেসই করা হয় না।
 */
export async function sendWishlistEvent(
  admin: GraphqlClient,
  shopId: string,
  customerId: string,
  entry: WishlistEntry,
) {
  if ((await connectedProviders(shopId)).length === 0) return;
  const data = await gql<{
    customer: { defaultEmailAddress: { emailAddress: string } | null } | null;
  }>(
    admin,
    `#graphql
    query WishlistCustomer($id: ID!) {
      customer(id: $id) { defaultEmailAddress { emailAddress } }
    }`,
    { id: `gid://shopify/Customer/${customerId}` },
  );
  const email = data.customer?.defaultEmailAddress?.emailAddress;
  if (!email) return;
  await queueEvent(shopId, "shopify", {
    email: email.toLowerCase(),
    name: "Wishlist added",
    properties: { productId: entry.productId, handle: entry.handle },
  });
}

/** টুল চালু আর প্ল্যানে থাকলে তবেই true */
export const wishlistEnabled = async (shop: ShopRef) =>
  (await enabledSettings(shop, wishlist)) !== null;
