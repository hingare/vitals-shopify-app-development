import { emailMarketing } from "@app/tools";
import db from "../db.server";
import { gql, offlineAdmin } from "./admin-client.server";
import { storeUrl, triggerFlow } from "./flows.server";
import { connectedProviders, queueContactSync, queueUnsubscribeSync } from "./integrations.server";
import { enqueueJob, registerJob } from "./queue.server";
import { customerDetails, findCustomer } from "./shopify-customers.server";
import { cleanEmail, enabledSettings } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * মার্কেটিং ইমেইলের গ্রাহক তালিকা।
 * সম্মতির আসল জায়গা Shopify-র customer: আমাদের ফর্ম থেকে কেউ রাজি হলে Shopify-তেও লেখা হয়,
 * আর Shopify-তে (বা Klaviyo-র মতো অন্য অ্যাপে, যা Shopify-তে লেখে) কেউ আনসাবস্ক্রাইব করলে
 * webhook দিয়ে এখানেও বন্ধ হয়। তাই দুই দিকেই একই অবস্থা থাকে।
 *
 * Shopify-র খবর দেরিতে, দুবার বা উল্টো ক্রমে আসতে পারে। তাই Shopify থেকে আসা প্রতিটা বদলের সাথে
 * Shopify-র নিজের সময় (`at`) রাখা হয়, আর পুরনো খবর নতুন অবস্থাকে বদলাতে পারে না।
 */
type ShopRow = { id: string; domain: string; plan: string | null };

export interface SubscribeInput {
  email: unknown;
  source: string;
  firstName?: string | null;
  /** Shopify customer-এর সংখ্যা-id */
  customerId?: string | null;
  /** খবরটা Shopify থেকেই এসেছে, তাই আবার Shopify-তে লিখতে হবে না */
  fromShopify?: boolean;
  /** Shopify-র হিসাবে সম্মতির সময় (Shopify থেকে আসা খবরে) */
  at?: Date | null;
  /** পুরনো গ্রাহক একসাথে আনার সময়: welcome ইমেইল বা সিঙ্ক নয় */
  quiet?: boolean;
}

export type SubscribeResult =
  | "created"
  | "resubscribed"
  | "exists"
  | "suppressed"
  | "invalid"
  /** Shopify-র পুরনো খবর: এর পরে তিনি আনসাবস্ক্রাইব করেছেন */
  | "stale";

const clip = (value: string | null | undefined, max: number) => value?.trim().slice(0, max) || null;

/** Shopify-র দেওয়া সময়; ভুল হলে null, আর ভবিষ্যতের সময় হলে এখনকার সময় (নইলে পরের সব খবর "পুরনো" ঠেকত) */
function eventTime(value: Date | null | undefined, now = new Date()): Date | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value > now ? now : value;
}

export async function subscribe(shop: ShopRow, input: SubscribeInput): Promise<SubscribeResult> {
  const email = cleanEmail(input.email);
  if (!email) return "invalid";
  const firstName = clip(input.firstName, 80);
  const customerId = clip(input.customerId, 30);
  const at = eventTime(input.at);
  const key = { shopId_email: { shopId: shop.id, email } };

  const existing = await db.subscriber.findUnique({ where: key });
  // bounce বা স্প্যাম অভিযোগ আসা ঠিকানা আর কখনো নিজে থেকে চালু হয় না
  if (existing?.status === "bounced" || existing?.status === "complained") return "suppressed";

  let result: SubscribeResult;
  if (existing?.status === "subscribed") {
    const fill = {
      ...(firstName && !existing.firstName ? { firstName } : {}),
      ...(customerId && !existing.customerId ? { customerId } : {}),
      // Shopify-র নতুন সম্মতির সময় মনে রাখা হয়, যাতে তার আগের (দেরিতে পৌঁছানো) আনসাবস্ক্রাইবের খবর বাদ পড়ে
      ...(at && at > existing.consentAt ? { consentAt: at } : {}),
    };
    if (Object.keys(fill).length > 0) await db.subscriber.update({ where: key, data: fill });
    return "exists";
  }
  if (existing) {
    // দেরিতে বা দ্বিতীয়বার পৌঁছানো পুরনো "রাজি" খবর পরের আনসাবস্ক্রাইবকে উল্টে দিতে পারে না
    if (at && existing.unsubscribedAt && at <= existing.unsubscribedAt) return "stale";
    await db.subscriber.update({
      where: key,
      data: {
        status: "subscribed",
        consentAt: at ?? new Date(),
        unsubscribedAt: null,
        ...(firstName ? { firstName } : {}),
        ...(customerId ? { customerId } : {}),
      },
    });
    result = "resubscribed";
  } else {
    const { count } = await db.subscriber.createMany({
      data: [
        {
          shopId: shop.id,
          email,
          firstName,
          customerId,
          source: input.source,
          ...(at ? { consentAt: at } : {}),
        },
      ],
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
  const at = eventTime(options.at);
  if (existing && at && at < existing.consentAt) return false;

  // Shopify-র খবরে Shopify-র সময়ই রাখা হয়, যাতে পরের খবরের সাথে একই ঘড়িতে তুলনা হয়
  const unsubscribedAt = at ?? new Date();
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
  // customers/create (shopify.app.toml-এর include_fields: শুধু এই দুটো ঘর আসে)
  id?: number | string;
  email?: string | null;
  // customers_email_marketing_consent/update
  customer_id?: number | string;
  email_address?: string | null;
  email_marketing_consent?: { state?: string | null; consent_updated_at?: string | null } | null;
}

export interface CustomerEvent {
  email: string;
  /** Shopify customer-এর সংখ্যা-id */
  customerId: string | null;
  /**
   * সম্মতির খবরে (customers_email_marketing_consent/update) থাকে: subscribed, unsubscribed, not_subscribed…
   * নতুন customer-এর খবরে (customers/create) সম্মতি আসেই না, তখন null।
   */
  state: string | null;
  /** Shopify-র হিসাবে সম্মতি কবে বদলেছে */
  at: Date | null;
}

/**
 * customers/create আর customers_email_marketing_consent/update-এর payload পড়ে।
 * ইমেইল না থাকলে (ক্রেতার তথ্যের অনুমতি না থাকলে Shopify ঘরটা ফাঁকা পাঠায়) null।
 */
export function parseCustomerPayload(payload: CustomerPayload): CustomerEvent | null {
  const email = cleanEmail(payload.email ?? payload.email_address);
  if (!email) return null;
  const rawId = payload.id ?? payload.customer_id ?? "";
  // খুব বড় সংখ্যা JSON থেকে পড়লে হুবহু থাকে না; ভুল id দিয়ে অন্য customer-কে ধরার চেয়ে id ছাড়া চলা ভালো
  const id = typeof rawId === "number" && !Number.isSafeInteger(rawId) ? "" : String(rawId);
  const consent = payload.email_marketing_consent;
  const at = consent?.consent_updated_at ? new Date(consent.consent_updated_at) : null;
  return {
    email,
    customerId: /^\d{1,20}$/.test(id) ? id : null,
    state: consent?.state ?? null,
    at: at && !Number.isNaN(at.getTime()) ? at : null,
  };
}

/**
 * স্টোরটা গ্রাহক তালিকা কাজে লাগায় কিনা: Email Marketing চালু, বা কোনো ইমেইল টুল (Klaviyo ইত্যাদি) যুক্ত।
 * যে স্টোর লাগায় না, তার Shopify গ্রাহকদের ঠিকানা আমরা জমাই না (অকারণে ক্রেতার তথ্য রাখা হয় না);
 * পরে চালু করলে মার্চেন্ট Subscribers পেজের "Import from Shopify" দিয়ে সবাইকে আনেন।
 */
async function usesList(shop: ShopRow): Promise<boolean> {
  if (await enabledSettings(shop, emailMarketing)) return true;
  return (await connectedProviders(shop.id)).length > 0;
}

/** Shopify webhook-এর উত্তর ৫ সেকেন্ডের মধ্যে চায়, তাই Shopify-কে জিজ্ঞেস করে এর বেশি অপেক্ষা করা হয় না */
const LOOKUP_TIMEOUT_MS = 3_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer from Shopify in ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Shopify-র customer webhook-এর খবর গ্রাহক তালিকায় বসায়।
 * - আনসাবস্ক্রাইব: তালিকায় থাকা ঠিকানায় সবসময়; অচেনা ঠিকানা মনে রাখা হয় শুধু তালিকা কাজে লাগলে।
 * - রাজি হওয়া: তালিকায় আগে থেকে থাকলে সরাসরি। নতুন কাউকে যোগ করার আগে Shopify-কে জিজ্ঞেস করা হয়
 *   (`admin`), কারণ নাম আর ট্যাগ webhook-এ আসে না, আর নতুন customer-এর খবরে সম্মতিও থাকে না।
 *   Shopify উত্তর না দিলে (বা দেরি করলে) সম্মতির খবরটা নাম ছাড়াই বসে; নতুন customer-এর খবর তখন বাদ পড়ে
 *   (সম্মতির আলাদা খবর বা পরের আমদানিতে তিনি আসবেন)।
 */
export async function applyCustomerEvent(
  shop: ShopRow,
  event: CustomerEvent,
  admin?: GraphqlClient | null,
): Promise<SubscribeResult | null> {
  const known = await db.subscriber.findUnique({
    where: { shopId_email: { shopId: shop.id, email: event.email } },
    select: { status: true },
  });

  if (event.state === "unsubscribed") {
    if (!known && !(await usesList(shop))) return null;
    await unsubscribe(shop.id, event.email, { fromShopify: true, at: event.at ?? undefined });
    return null;
  }
  // not_subscribed / pending / invalid: কিছু বদলায় না
  if (event.state && event.state !== "subscribed") return null;

  const input = {
    email: event.email,
    customerId: event.customerId,
    source: "shopify",
    fromShopify: true,
    at: event.at,
  };
  // তালিকায় থাকা কারো জন্য Shopify-কে জিজ্ঞেস করার কিছু নেই (আমাদের ফর্ম থেকে এলে এটা আমাদের লেখারই প্রতিধ্বনি)।
  // ব্যতিক্রম: আনসাবস্ক্রাইব করা কারো নামে নতুন customer-এর খবর, যাতে সম্মতি লেখা নেই।
  if (known && (event.state === "subscribed" || known.status !== "unsubscribed")) {
    return subscribe(shop, input);
  }
  if (!(await usesList(shop))) return null;

  const answer =
    admin && event.customerId
      ? await withTimeout(customerDetails(admin, event.customerId), LOOKUP_TIMEOUT_MS).catch(
          (error: unknown) => {
            console.warn("[subscribers] customer lookup failed", error);
            return null;
          },
        )
      : null;
  // উত্তরটা এই ঠিকানারই হতে হবে: এর মধ্যে ঠিকানা বদলে গিয়ে থাকলে অন্য ঠিকানার সম্মতি বা নাম এখানে খাটে না
  const details = answer?.email === event.email ? answer : null;
  // সম্মতি ছাড়া খবরে (নতুন customer) Shopify-র এখনকার উত্তরই ভরসা
  if (!event.state && details?.marketingState !== "SUBSCRIBED") return null;
  return subscribe(shop, {
    ...input,
    firstName: details?.firstName ?? null,
    // আমাদের Pop-up ফর্ম Shopify-র নিউজলেটার ফর্ম দিয়ে পাঠায়, সাথে "popup" ট্যাগ
    source: details?.tags.includes("popup") ? "popup" : "shopify",
    at: event.at ?? details?.marketingUpdatedAt ?? null,
  });
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

export async function pushConsent(admin: GraphqlClient, shopId: string, job: ConsentJob) {
  const consent = {
    marketingState: job.state,
    marketingOptInLevel: "SINGLE_OPT_IN",
    consentUpdatedAt: new Date().toISOString(),
  };
  const customer = await findCustomer(admin, job.email);

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
  if (customer.marketingState === job.state) return;
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
  defaultEmailAddress: {
    emailAddress: string;
    marketingState: string;
    marketingUpdatedAt?: string | null;
  } | null;
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
          defaultEmailAddress { emailAddress marketingState marketingUpdatedAt }
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
    const stamp = node.defaultEmailAddress.marketingUpdatedAt;
    const consentAt = eventTime(stamp ? new Date(stamp) : null);
    return [
      {
        shopId,
        email,
        firstName: clip(node.firstName, 80),
        customerId: node.id.split("/").pop() ?? null,
        source: "shopify",
        // Shopify-র হিসাবে কবে রাজি হয়েছেন (জানা থাকলে): এর পরের আনসাবস্ক্রাইবের খবর তখন ঠিকঠাক মানা হয়
        ...(consentAt ? { consentAt } : {}),
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
