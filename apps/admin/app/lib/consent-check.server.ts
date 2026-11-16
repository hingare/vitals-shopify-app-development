import { emailMarketing } from "@app/tools";
import db from "../db.server";
import { gql, offlineAdmin } from "./admin-client.server";
import { enqueueJob, registerJob } from "./queue.server";
import { findCustomer, shopifyTime } from "./shopify-customers.server";
import { subscribe, unsubscribe, usesList, type ConsentJob } from "./subscribers.server";
import { cleanEmail } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * মার্কেটিং ইমেইলের সম্মতি দিনে একবার Shopify-র সাথে মিলিয়ে দেখা।
 *
 * সাধারণত দুই দিক নিজে থেকেই মিলে থাকে: Shopify-র বদল webhook-এ আসে, আমাদের বদল কাজের লাইন দিয়ে Shopify-তে যায়।
 * কিন্তু আমাদের সার্ভার ৪ ঘণ্টার বেশি খবর নিতে না পারলে Shopify খবরটা ফেলে দেয়, আর আমাদের লেখা তিনবার ব্যর্থ
 * হলে থেমে যায়। তখন কেউ Shopify-তে আনসাবস্ক্রাইব করেও আমাদের তালিকায় "রাজি" থেকে যেতেন আর ইমেইল পেতেন।
 * তাই প্রতিদিন:
 *
 * 1. আমাদের তালিকা: প্রত্যেক "রাজি" ঠিকানা, আর গত ৩০ দিনে আনসাবস্ক্রাইব বা স্প্যাম অভিযোগ করা ঠিকানা,
 *    Shopify-র এখনকার অবস্থার সাথে মেলানো (customer id দিয়ে, এক অনুরোধে ১০০ জন)।
 * 2. Shopify-র নতুন রাজি: আগের মেলানোর পরে বদলানো "রাজি" customer, যাঁরা তালিকায় নেই, তাঁদের চুপচাপ যোগ
 *    (welcome ইমেইল ছাড়া; তালিকা কখনো Shopify থেকে আনা না হলে পুরনো গ্রাহকও এতে আসতে পারেন)।
 *
 * দুই দিকের অবস্থা আলাদা হলে যে বদলটা পরে হয়েছে সেটাই টেকে। কোনটা পরে তা জানা না গেলে আনসাবস্ক্রাইবটাই টেকে।
 */

type ShopRow = { id: string; domain: string; plan: string | null };

const PAGE = 100;
/** কত দিনের পুরনো আনসাবস্ক্রাইবও মিলিয়ে দেখা হয় (আমাদের লেখা Shopify-তে না পৌঁছালে এর মধ্যে ধরা পড়ে) */
const RECENT_OPT_OUT_DAYS = 30;
/** একই স্টোরে আবার মেলানোর আগে অন্তত এতক্ষণ */
const CHECK_EVERY_MS = 22 * 60 * 60_000;
/** স্টোরগুলোর মেলানো ৬ ঘণ্টায় ছড়ানো, যাতে সব একসাথে শুরু হয়ে অন্য কাজ আটকে না রাখে */
const SPREAD_MINUTES = 360;
/** আগের মেলানোর শুরুর এক ঘণ্টা আগে থেকে দেখা (Shopify আর আমাদের ঘড়ির ছোট পার্থক্যের জন্য) */
const OVERLAP_MS = 60 * 60_000;
/** পাতার মাঝে একটু বিরতি: Shopify-র অনুরোধের সীমা আর অন্য কাজের জন্য জায়গা */
const STEP_DELAY_MS = 1_000;
const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* কোন দিকে মেলাতে হবে                                                 */
/* ------------------------------------------------------------------ */

export interface LocalConsent {
  /** subscribed | unsubscribed | bounced | complained */
  status: string;
  source: string;
  consentAt: Date;
  unsubscribedAt: Date | null;
}

export interface RemoteConsent {
  /** SUBSCRIBED | UNSUBSCRIBED | NOT_SUBSCRIBED | PENDING | INVALID | REDACTED */
  state: string | null;
  /** Shopify-র হিসাবে কবে বদলেছে */
  at: Date | null;
}

export type ConsentFix =
  | { action: "none" }
  /** Shopify-তে পরে আনসাবস্ক্রাইব (বা কোনটা পরে জানা নেই): তালিকায়ও বন্ধ; `at` Shopify-র সময়, জানা থাকলে */
  | { action: "unsubscribe"; at: Date | null }
  /** আনসাবস্ক্রাইবের পরে Shopify-তে আবার রাজি: তালিকায়ও চালু */
  | { action: "subscribe"; at: Date }
  /** এখানকার বদলটা পরে, কিন্তু Shopify-তে পৌঁছায়নি: আবার লেখা */
  | { action: "push"; state: ConsentJob["state"] };

const NONE: ConsentFix = { action: "none" };

export function consentFix(local: LocalConsent, remote: RemoteConsent): ConsentFix {
  const remoteAt = remote.at;
  const after = (time: Date | null) => remoteAt !== null && time !== null && remoteAt > time;

  if (local.status === "subscribed") {
    if (remote.state !== "UNSUBSCRIBED" && remote.state !== "NOT_SUBSCRIBED") return NONE;
    // আমাদের ফর্মে নেওয়া সম্মতি (পপ-আপ, স্পিন হুইল…) Shopify-তে পৌঁছায়নি, কারণ Shopify-র অবস্থাটা তার আগের।
    // সময় ছাড়া "Not subscribed" মানে কখনো রাজি-না-হওয়া customer, সেটাও আগের ধরা হয়; সময় ছাড়া আনসাবস্ক্রাইব নয়।
    const ours = local.source !== "shopify";
    const before = remoteAt ? remoteAt <= local.consentAt : remote.state === "NOT_SUBSCRIBED";
    if (ours && before) return { action: "push", state: "SUBSCRIBED" };
    if (remote.state === "UNSUBSCRIBED") {
      return { action: "unsubscribe", at: after(local.consentAt) ? remoteAt : null };
    }
    // পরে "Not subscribed" করা: webhook-এ এলেও তালিকা বদলাত না
    return NONE;
  }

  // bounce সম্মতির ব্যাপার নয়, Shopify-তে লেখাও হয় না
  if (local.status !== "unsubscribed" && local.status !== "complained") return NONE;
  if (remote.state !== "SUBSCRIBED") return NONE;
  if (remoteAt && after(local.unsubscribedAt)) {
    // আনসাবস্ক্রাইবের পরে Shopify-তে আবার রাজি। স্প্যাম অভিযোগ করা ঠিকানা তালিকায় কখনো ফেরে না,
    // তবে Shopify-তে তাঁর নতুন সম্মতিতেও হাত দেওয়া হয় না।
    return local.status === "unsubscribed" ? { action: "subscribe", at: remoteAt } : NONE;
  }
  return { action: "push", state: "UNSUBSCRIBED" };
}

/* ------------------------------------------------------------------ */
/* মেলানোর ধাপ                                                         */
/* ------------------------------------------------------------------ */

interface ListRow extends LocalConsent {
  id: string;
  email: string;
  firstName: string | null;
  customerId: string | null;
}

interface CustomerNode {
  id?: string;
  firstName?: string | null;
  tags?: string[];
  defaultEmailAddress?: {
    emailAddress: string | null;
    marketingState: string;
    marketingUpdatedAt?: string | null;
  } | null;
}

const numericId = (gid: string | undefined) => gid?.split("/").pop() ?? null;

const remoteOf = (node: CustomerNode): RemoteConsent => ({
  state: node.defaultEmailAddress?.marketingState ?? null,
  at: shopifyTime(node.defaultEmailAddress?.marketingUpdatedAt),
});

/** customer id দিয়ে একসাথে অনেকের অবস্থা; মুছে যাওয়া customer বাদ */
async function customersById(admin: GraphqlClient, ids: string[]) {
  const found = new Map<string, CustomerNode>();
  if (ids.length === 0) return found;
  const data = await gql<{ nodes: Array<CustomerNode | null> }>(
    admin,
    `#graphql
    query ConsentCheck($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Customer { id defaultEmailAddress { emailAddress marketingState marketingUpdatedAt } }
      }
    }`,
    { ids: ids.map((id) => `gid://shopify/Customer/${id}`) },
  );
  for (const node of data.nodes) {
    const id = numericId(node?.id);
    if (node && id) found.set(id, node);
  }
  return found;
}

async function applyFix(shop: ShopRow, row: ListRow, fix: ConsentFix, customerId: string | null) {
  switch (fix.action) {
    case "none":
      return false;
    case "unsubscribe":
      // Shopify থেকে আসা বদল, তাই Shopify-তে আবার লেখা হয় না; সংযুক্ত ইমেইল টুলেও বন্ধ হয়
      return unsubscribe(shop.id, row.email, { fromShopify: true, at: fix.at ?? undefined });
    case "subscribe": {
      // webhook-এ এলে যা হতো তাই: ইমেইল টুলে যোগ, welcome আগে একবার গিয়ে থাকলে আর যায় না
      const result = await subscribe(shop, {
        email: row.email,
        customerId,
        source: row.source,
        fromShopify: true,
        at: fix.at,
      });
      return result === "resubscribed";
    }
    case "push": {
      const job: ConsentJob = {
        email: row.email,
        state: fix.state,
        ...(fix.state === "SUBSCRIBED" ? { firstName: row.firstName, source: row.source } : {}),
      };
      await enqueueJob(shop.id, "shopify-consent", { ...job });
      return true;
    }
  }
}

export interface CheckState {
  /** ours: আমাদের তালিকা মেলানো; theirs: Shopify-র নতুন রাজি খোঁজা */
  phase: "ours" | "theirs";
  /** ours: শেষ দেখা সারির id; theirs: Shopify-র পাতার চিহ্ন */
  cursor: string | null;
  /** এর পরে বদলানো customer-ই theirs-এ দেখা হয়; null হলে (প্রথম মেলানো) theirs বাদ */
  since: string | null;
  /** এই মেলানো কখন শুরু হলো (পরের মেলানোর `since`) */
  started: string;
  checked: number;
  fixed: number;
}

export function readState(payload: Record<string, unknown>, now: Date): CheckState {
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  const count = (value: unknown) => (typeof value === "number" && value >= 0 ? value : 0);
  return {
    phase: payload.phase === "theirs" ? "theirs" : "ours",
    cursor: text(payload.cursor),
    since: shopifyTime(text(payload.since))?.toISOString() ?? null,
    started: shopifyTime(text(payload.started))?.toISOString() ?? now.toISOString(),
    checked: count(payload.checked),
    fixed: count(payload.fixed),
  };
}

/** আমাদের তালিকার এক পাতা */
async function checkOurs(admin: GraphqlClient, shop: ShopRow, state: CheckState, now: Date) {
  const rows: ListRow[] = await db.subscriber.findMany({
    where: {
      shopId: shop.id,
      id: { gt: state.cursor ?? "" },
      OR: [
        { status: "subscribed" },
        {
          status: { in: ["unsubscribed", "complained"] },
          unsubscribedAt: { gte: new Date(now.getTime() - RECENT_OPT_OUT_DAYS * DAY_MS) },
        },
      ],
    },
    orderBy: { id: "asc" },
    take: PAGE,
  });

  const byId = await customersById(
    admin,
    rows.flatMap((row) => (row.customerId ? [row.customerId] : [])),
  );
  let fixed = 0;
  for (const row of rows) {
    const node = row.customerId ? byId.get(row.customerId) : undefined;
    let remote: RemoteConsent | null = null;
    let customerId = row.customerId;
    if (node && cleanEmail(node.defaultEmailAddress?.emailAddress) === row.email) {
      remote = remoteOf(node);
    } else if (row.status === "subscribed" || row.customerId) {
      // id জানা নেই, বা customer মুছে গেছে বা তাঁর ঠিকানা বদলেছে: ঠিকানা দিয়ে খোঁজা।
      // (id ছাড়া আনসাবস্ক্রাইব খোঁজা হয় না: Shopify-তে কাউকে বানিয়ে আনসাবস্ক্রাইব লেখা হয় না)
      const found = await findCustomer(admin, row.email);
      if (found) {
        customerId = numericId(found.id);
        remote = { state: found.marketingState, at: found.marketingUpdatedAt };
      }
    }
    if (customerId && customerId !== row.customerId) {
      await db.subscriber.update({ where: { id: row.id }, data: { customerId } });
    }

    let fix: ConsentFix;
    if (remote) fix = consentFix(row, remote);
    else if (row.status === "subscribed" && !row.customerId && row.source !== "shopify") {
      // আমাদের ফর্মের সম্মতি কখনো Shopify-তে পৌঁছায়নি (customer-ই নেই): customer সহ লেখা।
      // id থাকা মানে customer ছিল, মার্চেন্ট মুছেছেন; তাঁকে আবার বানানো হয় না।
      fix = { action: "push", state: "SUBSCRIBED" };
    } else fix = NONE;
    if (await applyFix(shop, row, fix, customerId)) fixed++;
  }

  const last = rows[rows.length - 1];
  return {
    checked: rows.length,
    fixed,
    next: rows.length === PAGE && last ? last.id : null,
  };
}

/** Shopify-র query-তে সময়: মিলিসেকেন্ড ছাড়া, উদ্ধৃতিতে */
const searchTime = (iso: string) => `'${iso.replace(/\.\d{3}Z$/, "Z")}'`;

/** আগের মেলানোর পরে বদলানো "রাজি" customer-দের এক পাতা */
async function checkTheirs(
  admin: GraphqlClient,
  shop: ShopRow,
  since: string,
  cursor: string | null,
) {
  const data = await gql<{
    customers: {
      nodes: CustomerNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }>(
    admin,
    `#graphql
    query ConsentCheckRecent($after: String, $query: String!) {
      customers(first: ${PAGE}, after: $after, query: $query) {
        nodes {
          id
          firstName
          tags
          defaultEmailAddress { emailAddress marketingState marketingUpdatedAt }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { after: cursor, query: `accepts_marketing:true AND updated_at:>=${searchTime(since)}` },
  );

  const nodes = data.customers.nodes.flatMap((node) => {
    const email = cleanEmail(node.defaultEmailAddress?.emailAddress);
    return email && node.defaultEmailAddress?.marketingState === "SUBSCRIBED"
      ? [{ node, email }]
      : [];
  });
  const known: ListRow[] = nodes.length
    ? await db.subscriber.findMany({
        where: { shopId: shop.id, email: { in: nodes.map((n) => n.email) } },
      })
    : [];
  const byEmail = new Map(known.map((row) => [row.email, row]));

  let fixed = 0;
  for (const { node, email } of nodes) {
    const remote = remoteOf(node);
    const customerId = numericId(node.id);
    const row = byEmail.get(email);
    if (row) {
      if (await applyFix(shop, row, consentFix(row, remote), customerId)) fixed++;
      continue;
    }
    // তালিকায় নেই: Shopify থেকে আনার মতোই চুপচাপ যোগ (পুরনো গ্রাহক হলে welcome ইমেইল অদ্ভুত লাগত)
    const result = await subscribe(shop, {
      email,
      firstName: node.firstName ?? null,
      customerId,
      // আমাদের Pop-up ফর্ম Shopify-র নিউজলেটার ফর্ম দিয়ে পাঠায়, সাথে "popup" ট্যাগ
      source: node.tags?.some((tag) => tag.trim().toLowerCase() === "popup") ? "popup" : "shopify",
      fromShopify: true,
      at: remote.at,
      quiet: true,
    });
    if (result === "created") fixed++;
  }

  const { hasNextPage, endCursor } = data.customers.pageInfo;
  return {
    checked: data.customers.nodes.length,
    fixed,
    next: hasNextPage ? endCursor : null,
  };
}

/** এক ধাপ (এক পাতা) চালায়; ফেরত দেয় পরের ধাপের অবস্থা, আর পুরো মেলানো শেষ কিনা */
export async function checkStep(
  admin: GraphqlClient,
  shop: ShopRow,
  state: CheckState,
  now = new Date(),
): Promise<{ state: CheckState; done: boolean }> {
  const page =
    state.phase === "ours"
      ? await checkOurs(admin, shop, state, now)
      : await checkTheirs(admin, shop, state.since ?? state.started, state.cursor);
  const next: CheckState = {
    ...state,
    checked: state.checked + page.checked,
    fixed: state.fixed + page.fixed,
  };
  if (page.next) return { state: { ...next, cursor: page.next }, done: false };
  if (state.phase === "ours" && state.since) {
    return { state: { ...next, phase: "theirs", cursor: null }, done: false };
  }
  return { state: { ...next, cursor: null }, done: true };
}

registerJob("consent-check", async (job) => {
  const shop = await db.shop.findUnique({ where: { id: job.shopId } });
  // এর মধ্যে আনইনস্টল, বা Email Marketing বন্ধ আর কোনো ইমেইল টুলও যুক্ত নেই: মেলানোর কিছু নেই
  if (!shop || shop.uninstalledAt || !(await usesList(shop))) return;
  const now = new Date();
  const { state, done } = await checkStep(
    await offlineAdmin(shop.domain),
    shop,
    readState(job.payload, now),
    now,
  );
  // শুরুর সময় progress-এ থাকে, কারণ শেষ ধাপে কাজের payload আর বদলায় না; পরের মেলানো এখান থেকে পড়ে
  const progress = { started: state.started, checked: state.checked, fixed: state.fixed };
  if (!done) return { again: true, payload: { ...state }, progress, delayMs: STEP_DELAY_MS };
  if (state.fixed > 0) {
    console.info(
      `[consent-check] ${shop.domain}: ${state.fixed} of ${state.checked} brought in line`,
    );
  }
  return { progress };
});

/* ------------------------------------------------------------------ */
/* কোন স্টোরে, কখন                                                    */
/* ------------------------------------------------------------------ */

/**
 * দিনে কয়েকবার ডাকা হয়: গ্রাহক তালিকা কাজে লাগানো (Email Marketing চালু, বা কোনো ইমেইল টুল যুক্ত) প্রত্যেক স্টোরে,
 * যেখানে গত ২২ ঘণ্টায় মেলানো হয়নি, মেলানোর কাজ লাইনে দেয়। ফেরত দেয় কয়টা স্টোরে।
 */
export async function queueConsentChecks(now = new Date()): Promise<number> {
  const [tools, integrations] = await Promise.all([
    db.toolSetting.findMany({
      where: { toolId: emailMarketing.id, enabled: true },
      select: { shopId: true },
    }),
    db.integration.findMany({ select: { shopId: true } }),
  ]);
  const ids = [...new Set([...tools, ...integrations].map((row) => row.shopId))];
  if (ids.length === 0) return 0;
  const shops = await db.shop.findMany({
    where: { id: { in: ids }, uninstalledAt: null },
    orderBy: { id: "asc" },
  });

  let queued = 0;
  for (const shop of shops) {
    if (!(await usesList(shop))) continue;
    const recent = await db.job.findFirst({
      where: {
        shopId: shop.id,
        kind: "consent-check",
        createdAt: { gt: new Date(now.getTime() - CHECK_EVERY_MS) },
      },
    });
    if (recent) continue;
    // আগের সফল মেলানোর শুরু থেকে Shopify-র নতুন রাজি দেখা হয়; তা না থাকলে (প্রথমবার) শুধু আমাদের তালিকা
    const last = await db.job.findFirst({
      where: { shopId: shop.id, kind: "consent-check", status: "done" },
      orderBy: { createdAt: "desc" },
    });
    const started = shopifyTime((last?.progress as { started?: string } | null)?.started);
    const since = started ? new Date(started.getTime() - OVERLAP_MS).toISOString() : null;
    await enqueueJob(
      shop.id,
      "consent-check",
      { since },
      {
        unique: true,
        runAt: new Date(now.getTime() + (queued % SPREAD_MINUTES) * 60_000),
      },
    );
    queued++;
  }
  return queued;
}
