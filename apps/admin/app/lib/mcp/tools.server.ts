import type { McpGrant, Shop } from "@prisma/client";
import { z } from "zod";
import { translate } from "@app/i18n";
import { canUseTool } from "@app/tool-sdk";
import { registry } from "@app/tools";
import db from "../../db.server";
import { offlineAdmin } from "../admin-client.server";
import { visibilityReport } from "../ai-visibility.server";
import { aiCredits } from "../ai/studio.server";
import { getToolStats } from "../analytics.server";
import { listCampaigns } from "../campaigns.server";
import { messageStats } from "../messages.server";
import { getOfferReport } from "../offer-stats.server";
import { getOffer, listOffers } from "../offers.server";
import { allowRequest } from "../rate-limit.server";
import { REVIEW_STATUSES } from "../reviews";
import { shortName, statusCounts } from "../reviews.server";
import { planOf } from "../shop.server";
import { getStoreReport } from "../store-analytics.server";
import { subscriberCounts } from "../subscribers.server";
import { embedEditorUrl, getToolStates } from "../tools.server";
import {
  ACTION_STATUSES,
  McpToolError,
  createAction,
  describeAction,
  featureChangeInput,
  offerChangeInput,
  recentActions,
  reviewChangeInput,
  type ActionTool,
} from "./actions.server";
import { adminAppUrl, type McpScope } from "./oauth.server";

/**
 * সহকারী কী দেখতে আর কী চাইতে পারে। পড়ার টুলে ক্রেতার ব্যক্তিগত তথ্য (ইমেইল, পুরো নাম) কখনো যায় না।
 * request_* টুল কিছু বদলায় না, শুধু মার্চেন্টের অনুমোদনের জন্য অনুরোধ রাখে (actions.server.ts)।
 */
export interface ToolContext {
  shop: Shop;
  grant: McpGrant;
  now: Date;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  input: z.ZodType;
  run: (args: unknown, ctx: ToolContext) => Promise<Record<string, unknown>>;
}

function tool<S extends z.ZodType>(def: {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  input: S;
  run: (args: z.output<S>, ctx: ToolContext) => Promise<Record<string, unknown>>;
}): McpTool {
  return def as unknown as McpTool;
}

const en = (key: string, vars?: Record<string, string | number>) => translate("en", key, vars);
const featureName = (toolId: string) => en(`tool.${toolId}.name`);

const days = (max: number) =>
  z.number().int().min(1).max(max).default(30).describe("How many days back, ending today");

const getStoreOverview = tool({
  name: "get_store_overview",
  title: "Store overview",
  description:
    "A quick summary of the store in this app: plan, features that are on, active offers, review counts, AI credits left this month and change requests waiting for the owner.",
  scope: "read",
  input: z.object({}),
  async run(_args, { shop, now }) {
    const [states, activeOffers, reviews, credits, waiting] = await Promise.all([
      getToolStates(shop.id),
      db.offer.count({ where: { shopId: shop.id, active: true } }),
      statusCounts(shop.id),
      aiCredits(shop),
      db.mcpAction.count({
        where: { shopId: shop.id, status: "pending", expiresAt: { gt: now } },
      }),
    ]);
    const plan = planOf(shop);
    return {
      store: shop.domain,
      plan: plan ?? "none",
      featuresOn: states
        .filter((state) => state.enabled && !state.tool.alwaysOn)
        .map((state) => ({ id: state.tool.id, name: featureName(state.tool.id) })),
      activeOffers,
      reviews,
      aiCredits: { used: credits.used, limit: credits.limit, left: credits.left },
      changeRequestsWaiting: waiting,
      appAdmin: adminAppUrl(shop.domain, "/app"),
    };
  },
});

const getSalesReport = tool({
  name: "get_sales_report",
  title: "Sales and visitors report",
  description:
    "Visitors, product views, add to carts, checkouts, orders and revenue for recent days, with traffic sources, devices, top pages and how much each app feature helped sell. Revenue is in the store's currency.",
  scope: "read",
  input: z.object({ days: days(90) }),
  async run({ days }, { shop }) {
    const [store, features] = await Promise.all([
      getStoreReport(shop.id, days),
      getToolStats(shop.id, days),
    ]);
    const { totals } = store;
    return {
      days,
      totals,
      conversionRate:
        totals.visitors > 0 ? Math.round((totals.orders / totals.visitors) * 10_000) / 100 : null,
      daily: store.daily,
      trafficSources: store.sources,
      devices: store.devices,
      topPages: store.pages,
      byFeature: features
        .map((row) => ({ ...row, name: featureName(row.toolId) }))
        .sort((a, b) => b.revenue - a.revenue),
      notes:
        "Store numbers come from the app's analytics pixel. Feature numbers count an order for every feature the shopper used before buying. conversionRate is orders per 100 visitors.",
    };
  },
});

const listFeatures = tool({
  name: "list_features",
  title: "App features",
  description:
    "Every feature (tool) of the app with its id, what it does, whether it is on, and whether the store's plan includes it. Use the ids with request_feature_change.",
  scope: "read",
  input: z.object({
    onlyOn: z.boolean().default(false).describe("true to list only the features that are on"),
  }),
  async run({ onlyOn }, { shop }) {
    const plan = planOf(shop);
    const states = await getToolStates(shop.id);
    return {
      plan: plan ?? "none",
      features: states
        .filter((state) => !onlyOn || state.enabled || state.tool.alwaysOn)
        .map(({ tool: item, enabled }) => ({
          id: item.id,
          name: featureName(item.id),
          description: en(`tool.${item.id}.description`),
          category: item.category,
          on: Boolean(item.alwaysOn) || enabled,
          canTurnOff: !item.alwaysOn,
          plan: item.plan,
          includedInPlan: plan !== null && canUseTool(item, plan),
        })),
    };
  },
});

const listOffersTool = tool({
  name: "list_offers",
  title: "Offers",
  description:
    "The store's offers (volume discounts, bundles, gifts, buy X get Y, upsells) with whether each is on and its orders, revenue and discount over the last 30 days. Use the ids with request_offer_change.",
  scope: "read",
  input: z.object({}),
  async run(_args, { shop }) {
    const [offers, report] = await Promise.all([listOffers(shop.id), getOfferReport(shop.id, 30)]);
    const none = { orders: 0, revenue: 0, discount: 0, aov: 0 };
    return {
      offers: offers.map((offer) => ({
        id: offer.id,
        name: offer.name,
        type: offer.type,
        on: offer.active,
        last30Days: report.offers[offer.id] ?? none,
      })),
      abTest: report.ab,
    };
  },
});

const listReviews = tool({
  name: "list_reviews",
  title: "Product reviews",
  description:
    "Recent product reviews by status: pending ones wait for approval, published ones show on the store, rejected ones are hidden. Shopper names are shortened and emails are never shared.",
  scope: "read",
  input: z.object({
    status: z.enum(REVIEW_STATUSES).default("pending").describe("Which reviews to list"),
    rating: z.number().int().min(1).max(5).optional().describe("Only reviews with this many stars"),
    limit: z.number().int().min(1).max(50).default(20).describe("How many reviews, newest first"),
  }),
  async run({ status, rating, limit }, { shop }) {
    const [rows, counts] = await Promise.all([
      db.review.findMany({
        where: { shopId: shop.id, status, ...(rating ? { rating } : {}) },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          productId: true,
          rating: true,
          title: true,
          body: true,
          authorName: true,
          verified: true,
          reply: true,
          createdAt: true,
        },
      }),
      statusCounts(shop.id),
    ]);
    return {
      status,
      counts,
      reviews: rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        title: row.title,
        text: row.body.slice(0, 1_000),
        author: shortName(row.authorName),
        verifiedBuyer: row.verified,
        productId: row.productId,
        storeReply: row.reply,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  },
});

const getReviewStats = tool({
  name: "get_review_stats",
  title: "Review summary",
  description:
    "How many reviews are pending, published and rejected, the average rating of published reviews, and how many published reviews have each star rating.",
  scope: "read",
  input: z.object({}),
  async run(_args, { shop }) {
    const [counts, byRating] = await Promise.all([
      statusCounts(shop.id),
      db.review.groupBy({
        by: ["rating"],
        where: { shopId: shop.id, status: "published" },
        _count: { _all: true },
      }),
    ]);
    const stars: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    let total = 0;
    let sum = 0;
    for (const row of byRating) {
      stars[String(row.rating)] = row._count._all;
      total += row._count._all;
      sum += row.rating * row._count._all;
    }
    return {
      counts,
      publishedAverage: total > 0 ? Math.round((sum / total) * 100) / 100 : null,
      publishedByStars: stars,
    };
  },
});

const getAiVisibility = tool({
  name: "get_ai_visibility",
  title: "AI search visibility",
  description:
    "Checks how well AI assistants and search engines can read the store: a score out of 100, each check with what to fix, and which AI crawlers robots.txt allows. Takes a few seconds because it visits the live store.",
  scope: "read",
  input: z.object({}),
  async run(_args, { shop }) {
    if (!allowRequest(`mcp-visibility:${shop.id}`, 10, 60 * 60_000)) {
      throw new McpToolError("This check can run 10 times an hour. Try again later.");
    }
    const admin = await offlineAdmin(shop.domain);
    const report = await visibilityReport(admin, shop, {
      themeEditorUrl: embedEditorUrl(shop.domain),
    });
    return {
      score: report.score,
      storeUrl: report.storeUrl,
      passwordProtected: report.passwordProtected,
      checks: report.checks.map((check) => ({
        check: en(`visibility.check.${check.id}`),
        state: check.state,
        detail: en(`visibility.check.${check.id}.${check.reason}`, check.params),
      })),
      aiCrawlers:
        report.crawlers?.map((crawler) => ({
          bot: crawler.token,
          purpose: crawler.purpose,
          allowed: crawler.allowed,
        })) ?? null,
      files: report.files,
    };
  },
});

const getEmailStats = tool({
  name: "get_email_marketing_stats",
  title: "Email marketing",
  description:
    "Email subscriber counts, emails sent, delivered, opened and clicked in recent days, recent campaigns and which automated emails (welcome, abandoned checkout, review request, win-back) are on.",
  scope: "read",
  input: z.object({ days: days(365) }),
  async run({ days }, { shop }) {
    const [subscribers, emails, campaigns, flows] = await Promise.all([
      subscriberCounts(shop.id),
      messageStats(shop.id, { days }),
      listCampaigns(shop.id),
      db.emailFlow.findMany({ where: { shopId: shop.id }, select: { key: true, enabled: true } }),
    ]);
    return {
      subscribers,
      days,
      emails,
      recentCampaigns: campaigns.slice(0, 10).map((campaign) => ({
        name: campaign.name,
        status: campaign.status,
        sentAt: campaign.sentAt?.toISOString() ?? null,
        recipients: campaign.recipients,
      })),
      automatedEmails: flows.map((flow) => ({ flow: flow.key, on: flow.enabled })),
    };
  },
});

const listChangeRequests = tool({
  name: "list_change_requests",
  title: "Change requests",
  description:
    "Changes that assistants asked for and whether the store owner approved them: pending (waiting), done, failed, rejected or expired.",
  scope: "read",
  input: z.object({
    status: z.enum(ACTION_STATUSES).optional().describe("Only requests with this status"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  async run({ status, limit }, { shop, now }) {
    const rows = await recentActions(shop.id, { status, take: limit }, now);
    return {
      requests: rows.map((row) => ({
        requestId: row.id,
        summary: describeAction(row.tool, row.input, row.details),
        status: row.status,
        askedBy: row.assistant,
        error: row.error,
        createdAt: row.createdAt,
        decidedAt: row.decidedAt,
      })),
    };
  },
});

type Details = Record<string, string | number | boolean | null>;

async function requestChange(
  ctx: ToolContext,
  name: ActionTool,
  args: Record<string, string | boolean>,
  details: Details,
  extra?: Details,
) {
  return createAction({
    shopId: ctx.shop.id,
    shopDomain: ctx.shop.domain,
    grantId: ctx.grant.id,
    assistant: ctx.grant.name,
    tool: name,
    args,
    details,
    extra,
    now: ctx.now,
  });
}

const requestFeatureChange = tool({
  name: "request_feature_change",
  title: "Ask to turn a feature on or off",
  description:
    "Asks the store owner to turn an app feature on or off. Nothing changes until they approve it in the app; share the returned approval link with them.",
  scope: "write",
  input: featureChangeInput,
  async run({ featureId, enabled }, ctx) {
    const item = registry.get(featureId);
    if (!item) {
      throw new McpToolError(`There is no feature "${featureId}". list_features shows the ids.`);
    }
    const name = featureName(item.id);
    if (item.alwaysOn) throw new McpToolError(`${name} is always on.`);
    const plan = planOf(ctx.shop);
    if (enabled && (!plan || !canUseTool(item, plan))) {
      throw new McpToolError(`${name} needs the ${item.plan} plan.`);
    }
    const row = await db.toolSetting.findUnique({
      where: { shopId_toolId: { shopId: ctx.shop.id, toolId: item.id } },
      select: { enabled: true },
    });
    if ((row?.enabled ?? false) === enabled) {
      return { status: "unchanged", message: `${name} is already ${enabled ? "on" : "off"}.` };
    }
    return requestChange(ctx, "request_feature_change", { featureId: item.id, enabled }, { name });
  },
});

const requestOfferChange = tool({
  name: "request_offer_change",
  title: "Ask to turn an offer on or off",
  description:
    "Asks the store owner to turn one of their offers on or off. Nothing changes until they approve it in the app; share the returned approval link with them.",
  scope: "write",
  input: offerChangeInput,
  async run({ offerId, active }, ctx) {
    const offer = await getOffer(ctx.shop.id, offerId);
    if (!offer)
      throw new McpToolError(`There is no offer "${offerId}". list_offers shows the ids.`);
    if (offer.active === active) {
      return { status: "unchanged", message: `${offer.name} is already ${active ? "on" : "off"}.` };
    }
    return requestChange(
      ctx,
      "request_offer_change",
      { offerId: offer.id, active },
      { name: offer.name, type: offer.type },
    );
  },
});

const requestReviewChange = tool({
  name: "request_review_change",
  title: "Ask to publish, hide or answer a review",
  description:
    "Asks the store owner to publish a review, hide it, or post a public reply under it. Nothing changes until they approve it in the app; share the returned approval link with them.",
  scope: "write",
  input: reviewChangeInput,
  async run({ reviewId, action, reply }, ctx) {
    const review = await db.review.findFirst({
      where: { id: reviewId, shopId: ctx.shop.id },
      select: { id: true, rating: true, authorName: true, status: true },
    });
    if (!review) {
      throw new McpToolError(`There is no review "${reviewId}". list_reviews shows the ids.`);
    }
    const target = action === "publish" ? "published" : action === "reject" ? "rejected" : null;
    if (target && review.status === target) {
      return { status: "unchanged", message: `This review is already ${target}.` };
    }
    return requestChange(
      ctx,
      "request_review_change",
      { reviewId: review.id, action, ...(reply ? { reply } : {}) },
      { rating: review.rating },
      { author: shortName(review.authorName) },
    );
  },
});

export const MCP_TOOLS: McpTool[] = [
  getStoreOverview,
  getSalesReport,
  listFeatures,
  listOffersTool,
  listReviews,
  getReviewStats,
  getAiVisibility,
  getEmailStats,
  listChangeRequests,
  requestFeatureChange,
  requestOfferChange,
  requestReviewChange,
];

const schemaCache = new Map<string, Record<string, unknown>>();

/** MCP-র inputSchema: JSON Schema (2020-12), অতিরিক্ত ঘর ছাড়া */
export function inputSchema(item: McpTool): Record<string, unknown> {
  let schema = schemaCache.get(item.name);
  if (!schema) {
    schema = { ...(z.toJSONSchema(item.input, { io: "input" }) as Record<string, unknown>) };
    // পুরনো কিছু ক্লায়েন্ট $schema দেখে ভুল বোঝে; 2020-12 MCP-তে এমনিতেই ধরা হয়
    delete schema.$schema;
    schema = { ...schema, type: "object", additionalProperties: false };
    schemaCache.set(item.name, schema);
  }
  return schema;
}

export function toolsFor(scopes: string[]): McpTool[] {
  return MCP_TOOLS.filter((item) => scopes.includes(item.scope));
}
