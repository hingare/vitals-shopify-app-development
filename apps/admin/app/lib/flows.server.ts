import { emailMarketing } from "@app/tools";
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { gql } from "./admin-client.server";
import {
  FLOWS,
  FLOW_KEYS,
  flowContentSchema,
  isFlowKey,
  type FlowContent,
  type FlowKey,
} from "./email-template";
import { enqueueEmail } from "./messages.server";
import { cleanEmail, enabledSettings, type ShopRef } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * স্বয়ংক্রিয় ইমেইল (flow): welcome, abandoned checkout, review request, win-back।
 * প্রতিটা flow মার্চেন্ট আলাদা করে চালু করেন; Email Marketing টুল বন্ধ থাকলে কোনোটাই চলে না।
 */
export interface FlowState {
  key: FlowKey;
  enabled: boolean;
  delayMinutes: number;
  content: FlowContent;
}

type ShopRow = ShopRef & { domain: string };

function readFlow(
  key: FlowKey,
  row?: { enabled: boolean; delayMinutes: number; content: unknown },
): FlowState {
  const parsed = flowContentSchema.safeParse(row?.content);
  return {
    key,
    enabled: row?.enabled ?? false,
    delayMinutes: row?.delayMinutes ?? FLOWS[key].delayMinutes,
    content: parsed.success ? parsed.data : FLOWS[key].content,
  };
}

export async function getFlows(shopId: string): Promise<FlowState[]> {
  const rows = await db.emailFlow.findMany({ where: { shopId } });
  return FLOW_KEYS.map((key) =>
    readFlow(
      key,
      rows.find((r) => r.key === key),
    ),
  );
}

export async function saveFlow(
  shopId: string,
  key: string,
  input: { enabled: boolean; delayMinutes: number; content: unknown },
) {
  if (!isFlowKey(key)) throw new Error("Unknown flow");
  const content = flowContentSchema.parse(input.content);
  const def = FLOWS[key];
  // ০ একটা বৈধ মান (welcome ইমেইল সাথে সাথে), তাই শুধু সংখ্যা না হলে তবেই ডিফল্ট
  const asked = Number.isFinite(input.delayMinutes)
    ? Math.round(input.delayMinutes)
    : def.delayMinutes;
  const delayMinutes = Math.min(def.maxDelay, Math.max(def.minDelay, asked));
  const data = { enabled: input.enabled, delayMinutes, content: content as Prisma.InputJsonValue };
  await db.emailFlow.upsert({
    where: { shopId_key: { shopId, key } },
    create: { shopId, key, ...data },
    update: data,
  });
}

export interface FlowTrigger {
  email: string;
  firstName?: string | null;
  buttonUrl: string;
  /** একই ঘটনার জন্য দুবার না পাঠাতে (যেমন চেকআউটের token) */
  dedupeKey: string;
  vars?: Record<string, string>;
  checkoutId?: string;
  /** ক্রেতা এই মুহূর্তে নিজে মার্কেটিংয়ে রাজি হয়েছেন (যেমন চেকআউটের টিক) */
  consented?: boolean;
}

/** flow চালু থাকলে ইমেইল লাইনে দেয়; পাঠানোর সময় সম্মতি আর মাসের সীমা আবার দেখা হয় */
export async function triggerFlow(
  shop: ShopRow,
  key: FlowKey,
  input: FlowTrigger,
  now = new Date(),
): Promise<boolean> {
  const tool = await enabledSettings(shop, emailMarketing);
  if (!tool) return false;
  const row = await db.emailFlow.findUnique({ where: { shopId_key: { shopId: shop.id, key } } });
  if (!row?.enabled) return false;
  const flow = readFlow(key, row);
  // welcome আর win-back সবসময় শুধু গ্রাহকদের জন্য; বাকি দুটো মার্চেন্টের সেটিং অনুযায়ী
  const subscribersOnly = key === "welcome" || key === "winback" || tool.subscribersOnly;
  return enqueueEmail(shop.id, {
    kind: "flow",
    refId: key,
    to: input.email,
    dedupeKey: `flow:${key}:${input.dedupeKey}`,
    sendAt: new Date(now.getTime() + flow.delayMinutes * 60_000),
    payload: {
      marketing: true,
      allowNonSubscribers: !subscribersOnly || input.consented === true,
      checkoutId: input.checkoutId,
      vars: { first_name: input.firstName?.trim() || "there", ...input.vars },
      content: { ...flow.content, buttonUrl: input.buttonUrl, imageUrl: "" },
    },
  });
}

export const storeUrl = (shop: { domain: string }) => `https://${shop.domain}`;

/* ------------------------------------------------------------------ */
/* Shopify webhook থেকে                                                */
/* ------------------------------------------------------------------ */

export interface CheckoutPayload {
  token?: string;
  email?: string | null;
  abandoned_checkout_url?: string;
  completed_at?: string | null;
  total_price?: string;
  currency?: string;
  buyer_accepts_marketing?: boolean;
  customer?: { first_name?: string | null } | null;
  shipping_address?: { first_name?: string | null } | null;
}

/** checkouts/create ও checkouts/update: ইমেইল জানা থাকলে চেকআউট রাখে আর abandoned ইমেইল লাইনে দেয় */
export async function recordCheckout(shop: ShopRow, payload: CheckoutPayload) {
  const email = cleanEmail(payload.email);
  const token = payload.token;
  const url = payload.abandoned_checkout_url;
  if (!email || !token || !url || !/^https:\/\//.test(url)) return;
  // flow বন্ধ থাকলে ক্রেতার কোনো তথ্যই রাখা হয় না
  const flow = await db.emailFlow.findUnique({
    where: { shopId_key: { shopId: shop.id, key: "abandoned-checkout" } },
    select: { enabled: true },
  });
  if (!flow?.enabled) return;
  const firstName = payload.shipping_address?.first_name ?? payload.customer?.first_name ?? null;
  const data = {
    email,
    firstName,
    recoveryUrl: url,
    total: payload.total_price ?? "0",
    currency: payload.currency ?? "",
    acceptsMarketing: payload.buyer_accepts_marketing === true,
    ...(payload.completed_at ? { completedAt: new Date(payload.completed_at) } : {}),
  };
  const row = await db.abandonedCheckout.upsert({
    where: { shopId_token: { shopId: shop.id, token } },
    create: { shopId: shop.id, token, ...data },
    update: data,
  });
  if (row.completedAt) return;
  await triggerFlow(shop, "abandoned-checkout", {
    email,
    firstName,
    buttonUrl: url,
    dedupeKey: token,
    checkoutId: row.id,
    consented: data.acceptsMarketing,
  });
}

export interface OrderPayload {
  id?: number | string;
  name?: string;
  email?: string | null;
  checkout_token?: string | null;
  customer?: { first_name?: string | null } | null;
  line_items?: Array<{ product_id?: number | null; title?: string }>;
}

/** orders/create: চেকআউট সম্পূর্ণ বলে চিহ্ন দেয় (তাহলে abandoned ইমেইল যায় না) আর শেষ অর্ডারের সময় রাখে */
export async function onOrderCreated(shopId: string, payload: OrderPayload, now = new Date()) {
  if (payload.checkout_token) {
    await db.abandonedCheckout.updateMany({
      where: { shopId, token: payload.checkout_token, completedAt: null },
      data: { completedAt: now },
    });
  }
  const email = cleanEmail(payload.email);
  if (email) {
    await db.subscriber.updateMany({ where: { shopId, email }, data: { lastOrderAt: now } });
    // যার অর্ডার হয়ে গেছে তার অন্য খোলা চেকআউটের ইমেইলও আর দরকার নেই
    await db.abandonedCheckout.updateMany({
      where: { shopId, email, completedAt: null },
      data: { completedAt: now },
    });
  }
}

/** orders/paid: review request ইমেইল (প্রথম প্রোডাক্টের পেজে নিয়ে যায়) */
export async function onOrderPaid(shop: ShopRow, admin: GraphqlClient, payload: OrderPayload) {
  const email = cleanEmail(payload.email);
  const first = payload.line_items?.find((item) => item.product_id);
  if (!email || !first?.product_id || !payload.id) return;
  const flow = await db.emailFlow.findUnique({
    where: { shopId_key: { shopId: shop.id, key: "review-request" } },
    select: { enabled: true },
  });
  if (!flow?.enabled) return;
  const data = await gql<{ product: { handle: string; title: string } | null }>(
    admin,
    `#graphql
    query ReviewProduct($id: ID!) { product(id: $id) { handle title } }`,
    { id: `gid://shopify/Product/${first.product_id}` },
  );
  if (!data.product) return;
  await triggerFlow(shop, "review-request", {
    email,
    firstName: payload.customer?.first_name,
    buttonUrl: `${storeUrl(shop)}/products/${data.product.handle}#app-reviews`,
    dedupeKey: String(payload.id),
    vars: { product: data.product.title, order: payload.name ?? "" },
  });
}

const WINBACK_PAGE = 500;

/** দিনে কয়েকবার: যাদের শেষ অর্ডার ঠিক এত দিন আগে (গত ২৪ ঘণ্টার জানালায়), তাদের win-back ইমেইল */
export async function queueWinbacks(now = new Date()) {
  const flows = await db.emailFlow.findMany({
    where: { key: "winback", enabled: true },
    include: { shop: { select: { id: true, domain: true, plan: true, uninstalledAt: true } } },
  });
  let queued = 0;
  for (const flow of flows) {
    if (flow.shop.uninstalledAt) continue;
    const edge = new Date(now.getTime() - flow.delayMinutes * 60_000);
    let cursor = "";
    for (;;) {
      const subscribers = await db.subscriber.findMany({
        where: {
          shopId: flow.shopId,
          status: "subscribed",
          lastOrderAt: { lte: edge, gt: new Date(edge.getTime() - 86_400_000) },
          id: { gt: cursor },
        },
        orderBy: { id: "asc" },
        take: WINBACK_PAGE,
      });
      for (const sub of subscribers) {
        const sent = await triggerFlow(
          flow.shop,
          "winback",
          {
            email: sub.email,
            firstName: sub.firstName,
            buttonUrl: storeUrl(flow.shop),
            // একই শেষ অর্ডারের জন্য একবারই, স্ক্যান যতবারই চলুক
            dedupeKey: `${sub.id}:${sub.lastOrderAt?.toISOString().slice(0, 10)}`,
          },
          // দেরি আগেই পেরিয়ে গেছে, তাই এখনই পাঠানো হবে
          edge,
        );
        if (sent) queued++;
      }
      if (subscribers.length < WINBACK_PAGE) break;
      cursor = subscribers[subscribers.length - 1]?.id ?? cursor;
    }
  }
  return queued;
}
