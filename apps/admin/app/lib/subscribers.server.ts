import db from "../db.server";
import { gql, offlineAdmin } from "./admin-client.server";
import { storeUrl, triggerFlow } from "./flows.server";
import { queueContactSync, queueUnsubscribeSync } from "./integrations.server";
import { enqueueJob, registerJob } from "./queue.server";
import { cleanEmail } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * মার্কেটিং ইমেইলের গ্রাহক তালিকা।
 * সম্মতির আসল জায়গা Shopify-র customer: আমাদের ফর্ম থেকে কেউ রাজি হলে Shopify-তেও লেখা হয়,
 * আর Shopify-তে (বা Klaviyo-র মতো অন্য অ্যাপে, যা Shopify-তে লেখে) কেউ আনসাবস্ক্রাইব করলে
 * webhook দিয়ে এখানেও বন্ধ হয়। তাই দুই দিকেই একই অবস্থা থাকে।
 */
type ShopRow = { id: string; domain: string; plan: string | null };

export interface SubscribeInput {
  email: unknown;
  source: string;
  firstName?: string | null;
  phone?: string | null;
  /** Shopify customer-এর সংখ্যা-id */
  customerId?: string | null;
  /** খবরটা Shopify থেকেই এসেছে, তাই আবার Shopify-তে লিখতে হবে না */
  fromShopify?: boolean;
  /** পুরনো গ্রাহক একসাথে আনার সময়: welcome ইমেইল বা সিঙ্ক নয় */
  quiet?: boolean;
}

export type SubscribeResult = "created" | "resubscribed" | "exists" | "suppressed" | "invalid";

const clip = (value: string | null | undefined, max: number) => value?.trim().slice(0, max) || null;

export async function subscribe(shop: ShopRow, input: SubscribeInput): Promise<SubscribeResult> {
  const email = cleanEmail(input.email);
  if (!email) return "invalid";
  const firstName = clip(input.firstName, 80);
  const phone = clip(input.phone, 30);
  const customerId = clip(input.customerId, 30);
  const key = { shopId_email: { shopId: shop.id, email } };

  const existing = await db.subscriber.findUnique({ where: key });
  // bounce বা স্প্যাম অভিযোগ আসা ঠিকানা আর কখনো নিজে থেকে চালু হয় না
  if (existing?.status === "bounced" || existing?.status === "complained") return "suppressed";

  let result: SubscribeResult;
  if (existing?.status === "subscribed") {
    const fill = {
      ...(firstName && !existing.firstName ? { firstName } : {}),
      ...(phone && !existing.phone ? { phone } : {}),
      ...(customerId && !existing.customerId ? { customerId } : {}),
    };
    if (Object.keys(fill).length > 0) await db.subscriber.update({ where: key, data: fill });
    return "exists";
  }
  if (existing) {
    await db.subscriber.update({
      where: key,
      data: {
        status: "subscribed",
        consentAt: new Date(),
        unsubscribedAt: null,
        ...(firstName ? { firstName } : {}),
        ...(phone ? { phone } : {}),
        ...(customerId ? { customerId } : {}),
      },
    });
    result = "resubscribed";
  } else {
    const { count } = await db.subscriber.createMany({
      data: [{ shopId: shop.id, email, firstName, phone, customerId, source: input.source }],
      skipDuplicates: true,
    });
    // একই মুহূর্তে আরেকটা অনুরোধ তৈরি করে ফেললে welcome ইমেইল ইত্যাদি সে-ই পাঠাবে
    if (count === 0) return "exists";
    result = "created";
  }
  if (input.quiet) return result;

  if (!input.fromShopify) {
    await enqueueJob(shop.id, "shopify-consent", {
      email,
      firstName,
      state: "SUBSCRIBED",
      source: input.source,
    });
  }
  await queueContactSync(shop.id, {
    email,
    source: input.source,
    ...(firstName ? { firstName } : {}),
    ...(phone ? { phone } : {}),
  });
  await triggerFlow(shop, "welcome", {
    email,
    firstName,
    buttonUrl: storeUrl(shop),
    // প্রতি ঠিকানায় একবারই (আবার সাবস্ক্রাইব করলে দ্বিতীয় welcome যায় না)
    dedupeKey: email,
  });
  return result;
}

/**
 * আনসাবস্ক্রাইব। তালিকায় না থাকলেও ঠিকানাটা "unsubscribed" হিসেবে রাখা হয়,
 * যাতে abandoned checkout-এর মতো ইমেইলও আর না যায়।
 */
export async function unsubscribe(
  shopId: string,
  rawEmail: unknown,
  options: { fromShopify?: boolean; at?: Date } = {},
): Promise<boolean> {
  const email = cleanEmail(rawEmail);
  if (!email) return false;
  const key = { shopId_email: { shopId, email } };
  const existing = await db.subscriber.findUnique({ where: key });
  if (existing && existing.status !== "subscribed") return false;
  // Shopify-র পুরনো খবর (আমাদের এখানে পরে আবার রাজি হয়েছেন) উপেক্ষা
  if (existing && options.at && options.at < existing.consentAt) return false;

  const unsubscribedAt = new Date();
  if (existing) {
    await db.subscriber.update({ where: key, data: { status: "unsubscribed", unsubscribedAt } });
  } else {
    await db.subscriber.createMany({
      data: [{ shopId, email, status: "unsubscribed", unsubscribedAt }],
      skipDuplicates: true,
    });
  }
  if (!options.fromShopify) {
    await enqueueJob(shopId, "shopify-consent", { email, state: "UNSUBSCRIBED" });
  }
  await queueUnsubscribeSync(shopId, email, existing?.source ?? "shopify");
  return true;
}

/* ------------------------------------------------------------------ */
/* Shopify webhook থেকে                                                */
/* ------------------------------------------------------------------ */

export interface CustomerPayload {
  id?: number | string;
  email?: string | null;
  first_name?: string | null;
  phone?: string | null;
  tags?: string | null;
  email_marketing_consent?: { state?: string | null; consent_updated_at?: string | null } | null;
  // customers_email_marketing_consent/update-এ
  customer_id?: number | string;
  email_address?: string | null;
}

export interface ConsentChange {
  email: string;
  customerId: string | null;
  firstName: string | null;
  phone: string | null;
  state: string;
  at: Date | null;
  source: string;
}

/** customers/create, customers/update আর customers_email_marketing_consent/update-এর payload পড়ে */
export function parseCustomerPayload(payload: CustomerPayload): ConsentChange | null {
  const email = cleanEmail(payload.email ?? payload.email_address);
  const state = payload.email_marketing_consent?.state;
  if (!email || !state) return null;
  const id = payload.id ?? payload.customer_id;
  const stamp = payload.email_marketing_consent?.consent_updated_at;
  const at = stamp ? new Date(stamp) : null;
  const tags = (payload.tags ?? "").split(",").map((t) => t.trim().toLowerCase());
  return {
    email,
    customerId: id ? String(id) : null,
    firstName: payload.first_name ?? null,
    phone: payload.phone ?? null,
    state,
    at: at && !Number.isNaN(at.getTime()) ? at : null,
    // আমাদের Pop-up ফর্ম Shopify-র নিউজলেটার ফর্ম দিয়ে পাঠায়, সাথে "popup" ট্যাগ
    source: tags.includes("popup") ? "popup" : "shopify",
  };
}

export async function applyConsentChange(shop: ShopRow, change: ConsentChange) {
  if (change.state === "subscribed") {
    return subscribe(shop, { ...change, fromShopify: true });
  }
  if (change.state === "unsubscribed") {
    await unsubscribe(shop.id, change.email, { fromShopify: true, at: change.at ?? undefined });
  }
  // not_subscribed / pending / invalid: কিছু বদলায় না
  return null;
}

/* ------------------------------------------------------------------ */
/* Shopify-তে সম্মতি লেখা                                              */
/* ------------------------------------------------------------------ */

interface ConsentJob {
  email: string;
  firstName?: string | null;
  state: "SUBSCRIBED" | "UNSUBSCRIBED";
  source?: string;
}

const quote = (value: string) => `"${value.replace(/["\\]/g, "")}"`;

export async function pushConsent(admin: GraphqlClient, shopId: string, job: ConsentJob) {
  const consent = {
    marketingState: job.state,
    marketingOptInLevel: "SINGLE_OPT_IN",
    consentUpdatedAt: new Date().toISOString(),
  };
  const found = await gql<{
    customers: {
      nodes: Array<{ id: string; defaultEmailAddress: { marketingState: string } | null }>;
    };
  }>(
    admin,
    `#graphql
    query CustomerByEmail($query: String!) {
      customers(first: 1, query: $query) { nodes { id defaultEmailAddress { marketingState } } }
    }`,
    { query: `email:${quote(job.email)}` },
  );
  const customer = found.customers.nodes[0];

  if (!customer) {
    if (job.state !== "SUBSCRIBED") return;
    const created = await gql<{
      customerCreate: {
        customer: { id: string } | null;
        userErrors: Array<{ message: string }>;
      };
    }>(
      admin,
      `#graphql
      mutation CreateSubscriber($input: CustomerInput!) {
        customerCreate(input: $input) { customer { id } userErrors { message } }
      }`,
      {
        input: {
          email: job.email,
          ...(job.firstName ? { firstName: job.firstName } : {}),
          tags: ["newsletter", ...(job.source ? [job.source] : [])],
          emailMarketingConsent: consent,
        },
      },
    );
    const errors = created.customerCreate.userErrors;
    if (errors.length > 0) throw new Error(errors.map((e) => e.message).join("; "));
    const id = created.customerCreate.customer?.id.split("/").pop();
    if (id) {
      await db.subscriber.updateMany({
        where: { shopId, email: job.email },
        data: { customerId: id },
      });
    }
    return;
  }

  await db.subscriber.updateMany({
    where: { shopId, email: job.email, customerId: null },
    data: { customerId: customer.id.split("/").pop() ?? null },
  });
  if (customer.defaultEmailAddress?.marketingState === job.state) return;
  const updated = await gql<{
    customerEmailMarketingConsentUpdate: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
    mutation UpdateConsent($input: CustomerEmailMarketingConsentUpdateInput!) {
      customerEmailMarketingConsentUpdate(input: $input) { userErrors { message } }
    }`,
    { input: { customerId: customer.id, emailMarketingConsent: consent } },
  );
  const errors = updated.customerEmailMarketingConsentUpdate.userErrors;
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join("; "));
}

registerJob("shopify-consent", async (job) => {
  const shop = await db.shop.findUnique({ where: { id: job.shopId } });
  if (!shop || shop.uninstalledAt) return;
  await pushConsent(await offlineAdmin(shop.domain), shop.id, job.payload as unknown as ConsentJob);
});

/* ------------------------------------------------------------------ */
/* Shopify থেকে পুরনো গ্রাহক আনা                                       */
/* ------------------------------------------------------------------ */

interface CustomerNode {
  id: string;
  firstName: string | null;
  defaultEmailAddress: { emailAddress: string; marketingState: string } | null;
  lastOrder: { createdAt: string } | null;
}

/** এক পাতা (১০০ জন) আনে; ফেরত দেয় কতজন যোগ হলো আর পরের পাতার চিহ্ন */
export async function importPage(admin: GraphqlClient, shopId: string, cursor: string | null) {
  const data = await gql<{
    customers: {
      nodes: CustomerNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }>(
    admin,
    `#graphql
    query MarketingCustomers($after: String) {
      customers(first: 100, after: $after, query: "accepts_marketing:true") {
        nodes {
          id
          firstName
          defaultEmailAddress { emailAddress marketingState }
          lastOrder { createdAt }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { after: cursor },
  );
  const rows = data.customers.nodes.flatMap((node) => {
    const email = cleanEmail(node.defaultEmailAddress?.emailAddress);
    if (!email || node.defaultEmailAddress?.marketingState !== "SUBSCRIBED") return [];
    return [
      {
        shopId,
        email,
        firstName: clip(node.firstName, 80),
        customerId: node.id.split("/").pop() ?? null,
        source: "shopify",
        // win-back ইমেইলের জন্য
        lastOrderAt: node.lastOrder ? new Date(node.lastOrder.createdAt) : null,
      },
    ];
  });
  // আগে থেকে থাকা (বিশেষ করে আনসাবস্ক্রাইব করা) কাউকে বদলানো হয় না
  const { count } = rows.length
    ? await db.subscriber.createMany({ data: rows, skipDuplicates: true })
    : { count: 0 };
  const { hasNextPage, endCursor } = data.customers.pageInfo;
  return { added: count, seen: data.customers.nodes.length, next: hasNextPage ? endCursor : null };
}

registerJob("subscribers-import", async (job) => {
  const shop = await db.shop.findUnique({ where: { id: job.shopId } });
  if (!shop || shop.uninstalledAt) return;
  const {
    cursor = null,
    added = 0,
    seen = 0,
  } = job.payload as {
    cursor?: string | null;
    added?: number;
    seen?: number;
  };
  const page = await importPage(await offlineAdmin(shop.domain), shop.id, cursor);
  const progress = { added: added + page.added, seen: seen + page.seen };
  if (!page.next) return { progress };
  return { again: true, payload: { cursor: page.next, ...progress }, progress };
});

/* ------------------------------------------------------------------ */
/* অ্যাডমিন পেজের জন্য                                                 */
/* ------------------------------------------------------------------ */

export const SUBSCRIBERS_PER_PAGE = 50;

export async function listSubscribers(
  shopId: string,
  options: { status?: string; search?: string; page?: number } = {},
) {
  const where = {
    shopId,
    ...(options.status ? { status: options.status } : {}),
    ...(options.search ? { email: { contains: options.search.trim().toLowerCase() } } : {}),
  };
  const page = Math.max(1, options.page ?? 1);
  const [rows, total] = await Promise.all([
    db.subscriber.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * SUBSCRIBERS_PER_PAGE,
      take: SUBSCRIBERS_PER_PAGE,
    }),
    db.subscriber.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / SUBSCRIBERS_PER_PAGE)) };
}

export async function subscriberCounts(shopId: string) {
  const groups = await db.subscriber.groupBy({
    by: ["status"],
    where: { shopId },
    _count: { _all: true },
  });
  const counts = { subscribed: 0, unsubscribed: 0, bounced: 0, complained: 0 };
  for (const g of groups) {
    if (g.status in counts) counts[g.status as keyof typeof counts] = g._count._all;
  }
  return counts;
}
