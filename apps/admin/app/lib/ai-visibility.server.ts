import { aiProductFaq, aiSeoSchema, productReviews } from "@app/tools";
import { canUseTool, type AnyTool } from "@app/tool-sdk";
import db from "../db.server";
import { gql } from "./admin-client.server";
import { isAllowed, parseRobots } from "./robots";
import { safeFetch, type SafeFetchResult } from "./safe-fetch.server";
import { getEmbedStatus, type GraphqlClient } from "./tools.server";

/**
 * AI ভিজিবিলিটি: Google আর AI সহকারীরা (ChatGPT, Claude, Gemini, Perplexity ...) স্টোরটা কতটা পড়তে
 * আর সুপারিশ করতে পারে, তার ১০০-র মধ্যে স্কোর। প্রতিটা ঘরের সাথে ঠিক করার পথ।
 * সব যাচাই পড়ার কাজ: স্টোরে কিছু লেখা হয় না। স্টোরফ্রন্ট পাতাগুলো আনা হয় safeFetch দিয়ে।
 * যা যাচাই করা যায়নি (পাসওয়ার্ড দেওয়া স্টোর, পাতা আসেনি) তা স্কোরে ধরা হয় না, ভুল নম্বরও দেয় না।
 */

export type BotPurpose = "search" | "user" | "training";

/**
 * পরিচিত AI ক্রলার (robots.txt-এর নাম)।
 * search: AI সার্চ আর উত্তরে স্টোর দেখায়; user: কেউ জিজ্ঞেস করলে পাতাটা খোলে;
 * training: মডেল শেখানো (আটকানো মার্চেন্টের নিজের পছন্দ, স্কোরে ধরা হয় না)।
 */
export const AI_BOTS: ReadonlyArray<{ token: string; purpose: BotPurpose }> = [
  { token: "OAI-SearchBot", purpose: "search" },
  { token: "Claude-SearchBot", purpose: "search" },
  { token: "PerplexityBot", purpose: "search" },
  { token: "Googlebot", purpose: "search" },
  { token: "Google-Extended", purpose: "search" },
  { token: "Bingbot", purpose: "search" },
  { token: "Applebot", purpose: "search" },
  { token: "DuckAssistBot", purpose: "search" },
  { token: "ChatGPT-User", purpose: "user" },
  { token: "Claude-User", purpose: "user" },
  { token: "Perplexity-User", purpose: "user" },
  { token: "GPTBot", purpose: "training" },
  { token: "ClaudeBot", purpose: "training" },
  { token: "Applebot-Extended", purpose: "training" },
  { token: "meta-externalagent", purpose: "training" },
  { token: "Amazonbot", purpose: "training" },
  { token: "CCBot", purpose: "training" },
  { token: "Bytespider", purpose: "training" },
];

export type CheckId =
  "schema" | "crawlers" | "descriptions" | "altText" | "seoFields" | "reviews" | "faq" | "homeMeta";

/** ১০০-র মধ্যে কোন ঘরের কত ভার */
const WEIGHTS: Record<CheckId, number> = {
  schema: 20,
  crawlers: 15,
  descriptions: 15,
  altText: 15,
  seoFields: 10,
  reviews: 10,
  faq: 10,
  homeMeta: 5,
};

export type CheckState = "pass" | "partial" | "fail" | "unknown" | "locked";

export interface Fix {
  /** অ্যাপের পাতা (/app/...), Shopify অ্যাডমিন (shopify://admin/...), বাইরের লিংক, বা এই পাতার অংশ (#meta) */
  href: string;
  /** বোতামের লেখা: visibility.fix.<action> */
  action: string;
}

export interface Check {
  id: CheckId;
  weight: number;
  state: CheckState;
  /** ০ থেকে ১; যাচাই না হলে বা প্ল্যানে না থাকলে null (স্কোরে ধরা হয় না) */
  value: number | null;
  /** লেখা: visibility.check.<id>.<reason> */
  reason: string;
  params: Record<string, string | number>;
  fix: Fix | null;
}

export interface CrawlerAccess {
  token: string;
  purpose: BotPurpose;
  allowed: boolean;
}

export interface VisibilityReport {
  score: number | null;
  checks: Check[];
  /** robots.txt পড়া না গেলে null */
  crawlers: CrawlerAccess[] | null;
  /** Shopify নিজে যে ফাইলগুলো বানায়; found null = যাচাই করা যায়নি */
  files: Array<{ path: string; url: string; found: boolean | null }>;
  storeUrl: string;
  /** স্টোরে পাসওয়ার্ড: ক্রলাররা কিছুই পড়তে পারে না */
  passwordProtected: boolean;
}

/** একটা প্রোডাক্টের বর্ণনা অন্তত এত শব্দের হলে AI-র কাজে লাগার মতো */
export const MIN_DESCRIPTION_WORDS = 40;
/** এতগুলো প্রোডাক্টে FAQ থাকলেই পুরো নম্বর (সব প্রোডাক্টে লাগে না) */
const FAQ_TARGET = 10;
const FETCH_TIMEOUT_MS = 6_000;

type Fetcher = (
  url: string,
  options: { maxBytes?: number; timeoutMs?: number },
) => Promise<SafeFetchResult>;

const QUERY = `#graphql
  query AiVisibility {
    shop { description primaryDomain { url } }
    productsCount(query: "status:active") { count }
    products(first: 50, sortKey: UPDATED_AT, reverse: true, query: "status:active") {
      nodes {
        onlineStoreUrl
        description(truncateAt: 600)
        seo { title description }
        media(first: 8) { nodes { mediaContentType alt } }
      }
    }
  }`;

interface StoreData {
  shop: { description: string | null; primaryDomain: { url: string } };
  productsCount: { count: number } | null;
  products: {
    nodes: Array<{
      onlineStoreUrl: string | null;
      description: string;
      seo: { title: string | null; description: string | null };
      media: { nodes: Array<{ mediaContentType: string; alt: string | null }> };
    }>;
  };
}

/** পাতা আনে; না এলে null (স্কোরে ভুল নম্বর না দিয়ে "যাচাই করা যায়নি") */
async function load(fetcher: Fetcher, url: string, maxBytes: number) {
  try {
    const page = await fetcher(url, { maxBytes, timeoutMs: FETCH_TIMEOUT_MS });
    const locked = /\/password\/?$/.test(new URL(page.url).pathname);
    return { ...page, locked };
  } catch {
    return null;
  }
}

/** পাতার JSON-LD: আমাদের Product আছে কিনা, আর থিম বা অন্য অ্যাপের Product কতগুলো */
export function productSchemas(html: string) {
  let ours = 0;
  let others = 0;
  for (const match of html.matchAll(
    /<script\b([^>]*\btype=["']?application\/ld\+json["']?[^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    const mine = /\bdata-app-schema\b/.test(match[1] ?? "");
    let data: unknown;
    try {
      data = JSON.parse(match[2] ?? "");
    } catch {
      continue;
    }
    const items = (Array.isArray(data) ? data : [data]).flatMap((item) => {
      const graph = (item as { "@graph"?: unknown })?.["@graph"];
      return Array.isArray(graph) ? graph : [item];
    });
    const products = items.filter((item) => {
      const type = (item as { "@type"?: unknown })?.["@type"];
      return type === "Product" || (Array.isArray(type) && type.includes("Product"));
    }).length;
    if (mine) ours += products;
    else others += products;
  }
  return { ours, others };
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const filled = (value: string | null | undefined) => Boolean(value?.trim());

function stateOf(value: number, pass: number, partial: number): CheckState {
  if (value >= pass) return "pass";
  return value >= partial ? "partial" : "fail";
}

function check(
  id: CheckId,
  state: CheckState,
  value: number | null,
  reason: string,
  params: Record<string, string | number> = {},
  fix: Fix | null = null,
): Check {
  return { id, weight: WEIGHTS[id], state, value, reason, params, fix };
}

const percent = (part: number, whole: number) => Math.round((part / whole) * 100);

/** ১০০-র মধ্যে: শুধু যাচাই করা ঘরগুলো নিয়ে, তাই যা দেখা যায়নি তার জন্য নম্বর কাটা যায় না */
export function scoreOf(checks: Check[]): number | null {
  const counted = checks.filter((item) => item.value !== null);
  const total = counted.reduce((sum, item) => sum + item.weight, 0);
  if (total === 0) return null;
  const got = counted.reduce((sum, item) => sum + item.weight * (item.value ?? 0), 0);
  return Math.round((got / total) * 100);
}

export async function visibilityReport(
  admin: GraphqlClient,
  shop: { id: string; plan: string | null },
  options: { themeEditorUrl: string; fetcher?: Fetcher },
): Promise<VisibilityReport> {
  const fetcher = options.fetcher ?? safeFetch;
  const plan = shop.plan === "starter" || shop.plan === "professional" ? shop.plan : null;
  const can = (tool: unknown) => plan !== null && canUseTool(tool as AnyTool, plan);
  const settingOf = (toolId: string) =>
    db.toolSetting.findUnique({ where: { shopId_toolId: { shopId: shop.id, toolId } } });

  const [store, embed, schemaRow, reviewsRow, faqRow, published, faqRows] = await Promise.all([
    gql<StoreData>(admin, QUERY),
    getEmbedStatus(admin),
    settingOf(aiSeoSchema.id),
    settingOf(productReviews.id),
    settingOf(aiProductFaq.id),
    db.review.count({ where: { shopId: shop.id, status: "published" } }),
    db.aiGeneration.findMany({
      where: { shopId: shop.id, toolId: aiProductFaq.id, status: "applied" },
      select: { input: true },
      take: 500,
    }),
  ]);

  const base = store.shop.primaryDomain.url.replace(/\/+$/, "");
  const products = store.products.nodes;
  const productUrl = products.find((product) => product.onlineStoreUrl)?.onlineStoreUrl ?? null;
  const [robots, llms, agents, productPage] = await Promise.all([
    load(fetcher, `${base}/robots.txt`, 500_000),
    load(fetcher, `${base}/llms.txt`, 2_000_000),
    load(fetcher, `${base}/agents.md`, 500_000),
    productUrl ? load(fetcher, productUrl, 5_000_000) : Promise.resolve(null),
  ]);
  const passwordProtected = [robots, llms, agents, productPage].some((page) => page?.locked);
  const readable = (page: Awaited<ReturnType<typeof load>>) =>
    page && !page.locked && page.status === 200 ? page : null;

  const checks: Check[] = [];

  // ---- Schema (JSON-LD) ----
  const parsed = aiSeoSchema.settings.safeParse(schemaRow?.settings ?? {});
  const schema = parsed.success ? parsed.data : aiSeoSchema.settings.parse({});
  const page = readable(productPage);
  const found = page ? productSchemas(page.body) : null;
  const toSchema = { href: `/app/tools/${aiSeoSchema.id}`, action: "openSettings" };
  const toEmbed = { href: options.themeEditorUrl, action: "embed" };
  if (!schemaRow?.enabled || !can(aiSeoSchema)) {
    checks.push(check("schema", "fail", 0, "off", {}, { ...toSchema, action: "turnOn" }));
  } else if (embed === false) {
    checks.push(check("schema", "fail", 0, "embedOff", {}, toEmbed));
  } else if (!schema.productSchema) {
    checks.push(check("schema", "partial", 0.5, "productOff", {}, toSchema));
  } else if (found && found.ours === 0) {
    // চালু আছে কিন্তু প্রোডাক্ট পাতায় আসেনি (থিমে embed বন্ধ, বা অন্য থিম প্রকাশিত)
    checks.push(check("schema", "partial", 0.5, "missing", {}, toEmbed));
  } else if (found && found.others > 0 && !schema.removeThemeDuplicates) {
    checks.push(check("schema", "partial", 0.75, "duplicates", { count: found.others }, toSchema));
  } else {
    checks.push(check("schema", "pass", 1, found ? "live" : "on"));
  }

  // ---- AI ক্রলার (robots.txt) ----
  let crawlers: CrawlerAccess[] | null = null;
  // robots.txt না থাকলে (4xx) নিয়ম অনুযায়ী সবকিছু খোলা; সার্ভারের সমস্যা (5xx) হলে জানা যায় না
  const robotsFile =
    !robots || robots.locked || robots.status >= 500
      ? null
      : robots.status >= 400
        ? ""
        : robots.body;
  if (robotsFile === null) {
    checks.push(check("crawlers", "unknown", null, "unknown"));
  } else {
    const groups = parseRobots(robotsFile);
    const productPath = productUrl ? new URL(productUrl).pathname : "/products/example";
    crawlers = AI_BOTS.map((bot) => ({
      ...bot,
      allowed: isAllowed(groups, bot.token, "/") && isAllowed(groups, bot.token, productPath),
    }));
    const answering = crawlers.filter((bot) => bot.purpose !== "training");
    const blocked = answering.filter((bot) => !bot.allowed);
    const value = 1 - blocked.length / answering.length;
    checks.push(
      blocked.length === 0
        ? check("crawlers", "pass", 1, "open")
        : check(
            "crawlers",
            stateOf(value, 1, 0.5),
            value,
            "blocked",
            { bots: blocked.map((bot) => bot.token).join(", "), count: blocked.length },
            { href: "shopify://admin/themes", action: "themes" },
          ),
    );
  }

  // ---- প্রোডাক্টের বর্ণনা ----
  const professional = plan === "professional";
  if (products.length === 0) {
    checks.push(check("descriptions", "unknown", null, "noProducts"));
  } else {
    const thin = products.filter((product) => words(product.description) < MIN_DESCRIPTION_WORDS);
    const value = 1 - thin.length / products.length;
    checks.push(
      thin.length === 0
        ? check("descriptions", "pass", 1, "good", { total: products.length })
        : check(
            "descriptions",
            stateOf(value, 0.8, 0.4),
            value,
            "thin",
            { thin: thin.length, total: products.length, words: MIN_DESCRIPTION_WORDS },
            professional
              ? { href: "/app/ai/ai-descriptions", action: "writeWithAi" }
              : { href: "shopify://admin/products", action: "products" },
          ),
    );
  }

  // ---- ছবির alt ----
  const images = products.flatMap((product) =>
    product.media.nodes.filter((media) => media.mediaContentType === "IMAGE"),
  );
  if (images.length === 0) {
    checks.push(check("altText", "unknown", null, "noImages"));
  } else {
    const missing = images.filter((image) => !filled(image.alt)).length;
    const value = 1 - missing / images.length;
    checks.push(
      missing === 0
        ? check("altText", "pass", 1, "good", { total: images.length })
        : check(
            "altText",
            stateOf(value, 0.9, 0.5),
            value,
            "missing",
            {
              missing,
              total: images.length,
              percent: percent(images.length - missing, images.length),
            },
            professional
              ? { href: "/app/ai/ai-alt-text", action: "writeWithAi" }
              : { href: "/app/seo-alt", action: "fillAlt" },
          ),
    );
  }

  // ---- SEO টাইটেল ও বর্ণনা ----
  if (products.length > 0) {
    const empty = products.filter(
      (product) => !filled(product.seo.title) || !filled(product.seo.description),
    ).length;
    const value = 1 - empty / products.length;
    checks.push(
      empty === 0
        ? check("seoFields", "pass", 1, "good", { total: products.length })
        : check(
            "seoFields",
            stateOf(value, 0.9, 0.5),
            value,
            "empty",
            { empty, total: products.length },
            { href: "#meta", action: "fillMeta" },
          ),
    );
  } else {
    checks.push(check("seoFields", "unknown", null, "noProducts"));
  }

  // ---- রিভিউ ----
  if (!reviewsRow?.enabled || !can(productReviews)) {
    checks.push(
      check(
        "reviews",
        "fail",
        0,
        "off",
        {},
        {
          href: `/app/tools/${productReviews.id}`,
          action: "turnOn",
        },
      ),
    );
  } else if (published === 0) {
    checks.push(
      check("reviews", "partial", 0.5, "none", {}, { href: "/app/reviews", action: "reviews" }),
    );
  } else {
    checks.push(check("reviews", "pass", 1, "good", { count: published }));
  }

  // ---- প্রোডাক্ট FAQ ----
  const productCount = store.productsCount?.count ?? products.length;
  if (!can(aiProductFaq)) {
    checks.push(
      check("faq", "locked", null, "locked", {}, { href: "/app/plans", action: "upgrade" }),
    );
  } else if (productCount === 0) {
    checks.push(check("faq", "unknown", null, "noProducts"));
  } else {
    const covered = new Set(
      faqRows
        .map((row) => (row.input as { productId?: unknown } | null)?.productId)
        .filter((id): id is string => typeof id === "string"),
    ).size;
    const target = Math.min(FAQ_TARGET, productCount);
    let value = Math.min(1, covered / target);
    if (covered > 0 && !faqRow?.enabled) {
      value = Math.min(value, 0.5);
      checks.push(
        check(
          "faq",
          "partial",
          value,
          "hidden",
          { count: covered },
          {
            href: `/app/tools/${aiProductFaq.id}`,
            action: "turnOn",
          },
        ),
      );
    } else {
      checks.push(
        check(
          "faq",
          value >= 1 ? "pass" : value > 0 ? "partial" : "fail",
          value,
          value >= 1 ? "good" : covered > 0 ? "few" : "none",
          { count: covered, target },
          value >= 1 ? null : { href: `/app/ai/${aiProductFaq.id}`, action: "writeFaq" },
        ),
      );
    }
  }

  // ---- হোম পেজের বর্ণনা ----
  checks.push(
    filled(store.shop.description)
      ? check("homeMeta", "pass", 1, "good")
      : check(
          "homeMeta",
          "fail",
          0,
          "empty",
          {},
          {
            href: "shopify://admin/online_store/preferences",
            action: "preferences",
          },
        ),
  );

  const fileOf = (path: string, result: Awaited<ReturnType<typeof load>>) => ({
    path,
    url: `${base}${path}`,
    found: result === null || result.locked ? null : result.status === 200,
  });

  return {
    score: scoreOf(checks),
    checks,
    crawlers,
    files: [fileOf("/llms.txt", llms), fileOf("/agents.md", agents)],
    storeUrl: base,
    passwordProtected,
  };
}
