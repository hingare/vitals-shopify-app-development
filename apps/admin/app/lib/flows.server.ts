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
  /** একই ঘটনার ইমেইল এখনো লাইনে থাকলে তার ঠিকানা আর লেখা এই নতুন তথ্যে বদলায় (পাঠানোর সময় বদলায় না) */
  refresh?: boolean;
}

const flowDedupeKey = (key: FlowKey, id: string) => `flow:${key}:${id}`;

interface LoadedFlow {
  /** Email Marketing-এর সেটিং: মার্কেটিং ইমেইল শুধু গ্রাহকদের জন্য কিনা */
  subscribersOnly: boolean;
  flow: FlowState;
}

/** Email Marketing আর এই flow দুটোই চালু থাকলে তাদের সেটিং, নইলে null */
async function loadFlow(shop: ShopRef, key: FlowKey): Promise<LoadedFlow | null> {
  const tool = await enabledSettings(shop, emailMarketing);
  if (!tool) return null;
  const row = await db.emailFlow.findUnique({ where: { shopId_key: { shopId: shop.id, key } } });
  if (!row?.enabled) return null;
  return { subscribersOnly: tool.subscribersOnly, flow: readFlow(key, row) };
}

/** চালু থাকা flow-এর ইমেইল লাইনে দেয়; false মানে একই ঘটনার ইমেইল আগেই লাইনে আছে */
function queueFlow(
  shop: ShopRef,
  key: FlowKey,
  loaded: LoadedFlow,
  input: FlowTrigger,
  now = new Date(),
): Promise<boolean> {
  // welcome আর win-back সবসময় শুধু গ্রাহকদের জন্য; বাকি দুটো মার্চেন্টের সেটিং অনুযায়ী
  const subscribersOnly = key === "welcome" || key === "winback" || loaded.subscribersOnly;
  return enqueueEmail(shop.id, {
    kind: "flow",
    refId: key,
    to: input.email,
    dedupeKey: flowDedupeKey(key, input.dedupeKey),
    refresh: input.refresh,
    sendAt: new Date(now.getTime() + loaded.flow.delayMinutes * 60_000),
    payload: {
      marketing: true,
      allowNonSubscribers: !subscribersOnly || input.consented === true,
      checkoutId: input.checkoutId,
      vars: { first_name: input.firstName?.trim() || "there", ...input.vars },
      content: { ...loaded.flow.content, buttonUrl: input.buttonUrl, imageUrl: "" },
    },
  });
}

/**
 * টুল আর flow চালু থাকলে ইমেইল লাইনে দেয়। পাঠানোর সময় আবার দেখা হয়: দুটো এখনো চালু কিনা, সম্মতি আর মাসের সীমা
 * (messages.server.ts)।
 */
export async function triggerFlow(
  shop: ShopRow,
  key: FlowKey,
  input: FlowTrigger,
  now = new Date(),
): Promise<boolean> {
  const loaded = await loadFlow(shop, key);
  return loaded ? queueFlow(shop, key, loaded, input, now) : false;
}

export const storeUrl = (shop: { domain: string }) => `https://${shop.domain}`;

/* ------------------------------------------------------------------ */
/* Shopify webhook থেকে                                                */
/* ------------------------------------------------------------------ */

export interface CheckoutPayload {
  token?: string;
  email?: string | null;
  abandoned_checkout_url?: string;
  /** Shopify-র হিসাবে চেকআউট শেষ কবে বদলেছে */
  updated_at?: string | null;
  completed_at?: string | null;
  total_price?: string;
  currency?: string;
  buyer_accepts_marketing?: boolean;
  customer?: { first_name?: string | null } | null;
  shipping_address?: { first_name?: string | null } | null;
}

const timeOf = (value: string | null | undefined) => {
  const time = value ? new Date(value) : null;
  return time && !Number.isNaN(time.getTime()) ? time : null;
};

/**
 * checkouts/create ও checkouts/update: ইমেইল জানা থাকলে চেকআউট রাখে আর abandoned ইমেইল লাইনে দেয়।
 *
 * ক্রেতা চেকআউটে ইমেইল শুধরে নিতে পারেন, আর Shopify-র খবর উল্টো ক্রমেও আসতে পারে। তাই:
 * - সারিতে Shopify-র `updated_at` রাখা হয়, আর তার চেয়ে পুরনো খবর নতুন তথ্যের উপর বসে না;
 * - লাইনে থাকা ইমেইলের ঠিকানা আর লেখা প্রতিবার সারির এখনকার তথ্যে বদলায়, যাতে ইমেইলটা
 *   প্রথমে লেখা (হয়তো ভুল বানানের, অন্য কারো) ঠিকানায় না গিয়ে শেষ ঠিকানায় যায়;
 * - ক্রেতা ইমেইল সরিয়ে নিলে সারি আর লাইনের ইমেইল দুটোই মুছে যায়।
 *
 * Email Marketing বা এই flow বন্ধ থাকলে নতুন কোনো চেকআউট রাখা হয় না, কোনো ইমেইলও লাইনে পড়ে না।
 */
export async function recordCheckout(shop: ShopRow, payload: CheckoutPayload) {
  const token = payload.token;
  if (!token) return;
  const email = cleanEmail(payload.email);
  const stamp = timeOf(payload.updated_at);
  const completedAt = timeOf(payload.completed_at);
  // এই খবরের চেয়ে নতুন কিছু আগে বসে থাকলে সারিটা ছোঁয়া হয় না
  const notNewer = stamp
    ? { OR: [{ sourceUpdatedAt: null }, { sourceUpdatedAt: { lte: stamp } }] }
    : {};

  if (!email) {
    // সময় জানা না থাকলে খবরটা নতুন না পুরনো বোঝা যায় না, তখন কিছু মোছা হয় না
    if (!stamp) return;
    const gone = await db.abandonedCheckout.deleteMany({
      where: { shopId: shop.id, token, completedAt: null, ...notNewer },
    });
    if (gone.count > 0) {
      await db.message.deleteMany({
        where: {
          shopId: shop.id,
          dedupeKey: flowDedupeKey("abandoned-checkout", token),
          status: "queued",
        },
      });
    }
    return;
  }
  const url = payload.abandoned_checkout_url;
  if (!url || !/^https:\/\//.test(url)) return;
  const loaded = await loadFlow(shop, "abandoned-checkout");

  const data = {
    email,
    firstName: payload.shipping_address?.first_name ?? payload.customer?.first_name ?? null,
    recoveryUrl: url,
    // কলামটা দশমিক সংখ্যার; অচেনা লেখা এলে পুরো চেকআউট হারানোর বদলে ০ রাখা হয়
    total: /^\d{1,12}(\.\d+)?$/.test(payload.total_price ?? "") ? payload.total_price! : "0",
    currency: payload.currency ?? "",
    acceptsMarketing: payload.buyer_accepts_marketing === true,
    ...(stamp ? { sourceUpdatedAt: stamp } : {}),
    ...(completedAt ? { completedAt } : {}),
  };
  const key = { shopId: shop.id, token };
  // শর্তসহ একটাই লেখা, যাতে একসাথে আসা দুটো খবরের পুরনোটা জিততে না পারে
  const apply = () => db.abandonedCheckout.updateMany({ where: { ...key, ...notNewer }, data });
  if ((await apply()).count === 0) {
    // টুল বা flow বন্ধ থাকলে নতুন কোনো ক্রেতার তথ্য রাখা হয় না। আগে থেকে থাকা সারি তবু হালনাগাদ থাকে (উপরের লেখা),
    // যাতে আবার চালু করলে লাইনে থাকা ইমেইল পুরনো, শুধরে নেওয়া ঠিকানায় না যায়।
    const created = loaded
      ? await db.abandonedCheckout.createMany({ data: [{ ...key, ...data }], skipDuplicates: true })
      : { count: 0 };
    // বানানো যায়নি মানে সারিটা আছে: একই চেকআউটের আরেকটা খবর এইমাত্র বানিয়েছে (তখন এই খবরটা আবার বসানো হয়),
    // বা তাতে এর চেয়ে নতুন তথ্য আছে (তখন পুরনো খবর থেকে শুধু "অর্ডার হয়ে গেছে" কথাটা নেওয়া হয়)
    if (created.count === 0 && (!loaded || (await apply()).count === 0)) {
      if (completedAt) {
        await db.abandonedCheckout.updateMany({
          where: { ...key, completedAt: null },
          data: { completedAt },
        });
      }
      return;
    }
  }
  if (!loaded) return;

  // লাইনের ইমেইলে সারির এখনকার তথ্য বসে। একই চেকআউটের আরেকটা খবর ঠিক এই ফাঁকে সারি বদলে দিলে আরেকবার বসানো হয়,
  // যাতে লাইনের ইমেইল সারির সাথে মিলে থাকে (তবু না মিললে পাঠানোর সময় ইমেইলটা বাদ পড়ে, ভুল ঠিকানায় যায় না)।
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await db.abandonedCheckout.findUnique({ where: { shopId_token: key } });
    if (!row || row.completedAt) return;
    await queueFlow(shop, "abandoned-checkout", loaded, {
      email: row.email,
      firstName: row.firstName,
      buttonUrl: row.recoveryUrl,
      dedupeKey: token,
      checkoutId: row.id,
      consented: row.acceptsMarketing,
      refresh: true,
    });
    const after = await db.abandonedCheckout.findUnique({ where: { shopId_token: key } });
    if (
      !after ||
      (after.email === row.email &&
        after.firstName === row.firstName &&
        after.recoveryUrl === row.recoveryUrl &&
        after.acceptsMarketing === row.acceptsMarketing)
    ) {
      return;
    }
  }
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
  // টুল বা flow বন্ধ থাকলে Shopify-কে প্রোডাক্টের কথা জিজ্ঞেসও করা হয় না
  const loaded = await loadFlow(shop, "review-request");
  if (!loaded) return;
  const data = await gql<{ product: { handle: string; title: string } | null }>(
    admin,
    `#graphql
    query ReviewProduct($id: ID!) { product(id: $id) { handle title } }`,
    { id: `gid://shopify/Product/${first.product_id}` },
  );
  if (!data.product) return;
  await queueFlow(shop, "review-request", loaded, {
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
    // টুল বন্ধ (বা প্ল্যানে নেই): গ্রাহকদের খোঁজাই হয় না
    const loaded = await loadFlow(flow.shop, "winback");
    if (!loaded) continue;
    const edge = new Date(now.getTime() - loaded.flow.delayMinutes * 60_000);
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
        const sent = await queueFlow(
          flow.shop,
          "winback",
          loaded,
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
