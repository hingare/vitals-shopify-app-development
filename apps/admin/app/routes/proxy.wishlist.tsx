import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { allowRequest } from "../lib/rate-limit.server";
import { activeShop, clientIp, jsonResponse, readJson } from "../lib/tool-state.server";
import {
  changeWishlist,
  listWishlist,
  mergeGuestList,
  ownerKeys,
  sendWishlistEvent,
  wishlistEnabled,
} from "../lib/wishlist.server";

/**
 * Wishlist উইজেট এখানে তালিকা পড়ে ও বদলায় (App Proxy: /apps/app-tools/wishlist)।
 * লগইন করা ক্রেতার id Shopify নিজে সই করা অনুরোধে দেয় (logged_in_customer_id), ব্রাউজার সেটা বানাতে পারে না।
 */
async function context(request: Request, guestId: unknown) {
  const { session, admin } = await authenticate.public.appProxy(request);
  const shop = await activeShop(session?.shop);
  if (!shop || !(await wishlistEnabled(shop))) return null;
  const customerId = new URL(request.url).searchParams.get("logged_in_customer_id");
  const keys = ownerKeys(customerId, guestId);
  // লগইন করার পরে প্রথম অনুরোধেই অতিথির তালিকা ক্রেতার তালিকায় মেশে
  if (keys.customer && keys.guest) await mergeGuestList(shop.id, keys.guest, keys.customer);
  return {
    shop,
    admin,
    customerId: keys.customer ? customerId : null,
    owner: keys.customer ?? keys.guest,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await context(request, new URL(request.url).searchParams.get("g"));
  if (!ctx) return jsonResponse({ error: "disabled" }, 404);
  if (!ctx.owner) return jsonResponse({ items: [], customer: false });
  return jsonResponse({
    items: await listWishlist(ctx.shop.id, ctx.owner),
    customer: Boolean(ctx.customerId),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const body = (await readJson(request)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonResponse({ error: "invalid" }, 400);
  const ctx = await context(request, body.g);
  if (!ctx) return jsonResponse({ error: "disabled" }, 404);
  if (!ctx.owner) return jsonResponse({ error: "invalid" }, 400);
  if (!allowRequest(`wishlist:${ctx.shop.id}:${clientIp(request)}`, 60, 60_000)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }
  const entry = { productId: body.productId, handle: body.handle };
  const result = await changeWishlist(ctx.shop.id, ctx.owner, body.action, entry);
  if (result === "invalid") return jsonResponse({ error: "invalid" }, 400);
  if (result === "full") return jsonResponse({ error: "full" }, 409);
  if (result === "added" && ctx.customerId && ctx.admin) {
    await sendWishlistEvent(ctx.admin, ctx.shop.id, ctx.customerId, {
      productId: String(body.productId),
      handle: String(body.handle),
    }).catch((error: unknown) => console.warn("[wishlist] event failed", error));
  }
  return jsonResponse({
    items: await listWishlist(ctx.shop.id, ctx.owner),
    customer: Boolean(ctx.customerId),
  });
};
