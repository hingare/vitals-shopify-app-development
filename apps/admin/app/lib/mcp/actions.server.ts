import type { Prisma } from "@prisma/client";
import { z } from "zod";
import db from "../../db.server";
import { queueSummaryRefresh } from "../ai/tasks/review-summary.server";
import { getOffer } from "../offers.server";
import { moderate, shortName, syncProductRating } from "../reviews.server";
import { planOf } from "../shop.server";
import { ToolError, saveTool, syncStoreConfig, type GraphqlClient } from "../tools.server";
import { describeAction, type ActionStatus } from "./describe";
import { adminAppUrl } from "./oauth.server";

/**
 * AI সহকারীর চাওয়া পরিবর্তন। সহকারী নিজে কিছু বদলায় না: প্রতিটা অনুরোধ এখানে অপেক্ষায় থাকে,
 * মার্চেন্ট অ্যাপের "AI সহকারী" পাতায় দেখে অনুমোদন দিলে তবেই তার নিজের অ্যাডমিন সেশন দিয়ে কাজটা হয়।
 * ভুল বা দুষ্টু নির্দেশ (prompt injection) পেলেও তাই স্টোরে কিছু ঘটে না।
 */
export const ACTION_DAYS = 7;
/** একসাথে এর বেশি অপেক্ষমাণ অনুরোধ নয় (মার্চেন্টের তালিকা ভরে না যায়) */
const MAX_PENDING = 25;
const MAX_PER_DAY = 100;

/** সহকারীকে দেখানোর মতো ভুল (ভেতরের খবর নয়) */
export class McpToolError extends Error {}

const id = (what: string) => z.string().trim().min(1).max(100).describe(what);

export const featureChangeInput = z.object({
  featureId: id("Feature id from list_features, like sticky-add-to-cart"),
  enabled: z.boolean().describe("true to turn the feature on, false to turn it off"),
});

export const offerChangeInput = z.object({
  offerId: id("Offer id from list_offers"),
  active: z.boolean().describe("true to turn the offer on, false to turn it off"),
});

export const reviewChangeInput = z
  .object({
    reviewId: id("Review id from list_reviews"),
    action: z
      .enum(["publish", "reject", "reply"])
      .describe(
        "publish shows it on the store, reject hides it, reply adds the store's public answer",
      ),
    reply: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .optional()
      .describe("The store's answer, shown under the review. Needed when action is reply"),
  })
  .refine((value) => value.action !== "reply" || Boolean(value.reply), {
    message: "reply is required when action is reply",
    path: ["reply"],
  });

export const ACTION_TOOLS = [
  "request_feature_change",
  "request_offer_change",
  "request_review_change",
] as const;
export type ActionTool = (typeof ACTION_TOOLS)[number];

/** অনুমোদনের পাতা (স্টোরের অ্যাডমিনে) */
export const approveUrl = (shopDomain: string, actionId: string) =>
  adminAppUrl(shopDomain, `/app/assistants?action=${encodeURIComponent(actionId)}`);

type Details = Record<string, string | number | boolean | null>;

export { ACTION_STATUSES, describeAction, type ActionStatus } from "./describe";

export async function createAction(input: {
  shopId: string;
  shopDomain: string;
  grantId: string;
  assistant: string;
  tool: ActionTool;
  args: Prisma.InputJsonObject;
  /** সারিতে থাকে (ক্রেতার নাম নয়) */
  details: Details;
  /** শুধু এখনকার উত্তরের লেখায় (যেমন রিভিউকারীর ছোট নাম); কোথাও রাখা হয় না */
  extra?: Details;
  now: Date;
}) {
  const [pending, today] = await Promise.all([
    db.mcpAction.count({
      where: { shopId: input.shopId, status: "pending", expiresAt: { gt: input.now } },
    }),
    db.mcpAction.count({
      where: {
        shopId: input.shopId,
        createdAt: { gt: new Date(input.now.getTime() - 86_400_000) },
      },
    }),
  ]);
  if (pending >= MAX_PENDING) {
    throw new McpToolError(
      "Too many requests are already waiting for the store owner. Ask them to review those first.",
    );
  }
  if (today >= MAX_PER_DAY) throw new McpToolError("Too many requests today. Try again tomorrow.");
  const expiresAt = new Date(input.now.getTime() + ACTION_DAYS * 86_400_000);
  const action = await db.mcpAction.create({
    data: {
      shopId: input.shopId,
      grantId: input.grantId,
      assistant: input.assistant.slice(0, 80),
      tool: input.tool,
      input: input.args,
      details: input.details,
      expiresAt,
    },
  });
  return {
    status: "waiting_for_approval",
    requestId: action.id,
    summary: describeAction(input.tool, input.args, { ...input.details, ...input.extra }),
    approveUrl: approveUrl(input.shopDomain, action.id),
    expiresAt: expiresAt.toISOString(),
    message:
      "Nothing has changed yet. The store owner must approve this request in the app. Share the approval link with them; list_change_requests shows the result.",
  };
}

const viewOf = (row: Awaited<ReturnType<typeof db.mcpAction.findMany>>[number], now: Date) => ({
  id: row.id,
  assistant: row.assistant,
  tool: row.tool,
  input: row.input as Record<string, unknown>,
  details: row.details as Record<string, unknown>,
  // সময় পেরোনো অপেক্ষমাণ অনুরোধ পরিষ্কারের আগেও "সময় শেষ" দেখায়
  status: (row.status === "pending" && row.expiresAt <= now
    ? "expired"
    : row.status) as ActionStatus,
  error: row.error,
  createdAt: row.createdAt.toISOString(),
  decidedAt: row.decidedAt?.toISOString() ?? null,
  expiresAt: row.expiresAt.toISOString(),
});
export type ActionView = ReturnType<typeof viewOf>;

/**
 * রিভিউর অনুরোধে রিভিউকারীর ছোট নাম ("Rahim K.") দেখানোর সময় রিভিউ থেকে পড়া হয়, অনুরোধে রাখা হয় না:
 * ক্রেতা তথ্য মুছতে বললে (customers/redact) রিভিউর সাথেই নামটাও চলে যায়।
 */
async function withAuthors(shopId: string, views: ActionView[]): Promise<ActionView[]> {
  const ids = views
    .filter((view) => view.tool === "request_review_change")
    .map((view) => String(view.input.reviewId ?? ""))
    .filter(Boolean);
  if (ids.length === 0) return views;
  const reviews = await db.review.findMany({
    where: { shopId, id: { in: [...new Set(ids)] } },
    select: { id: true, authorName: true },
  });
  const names = new Map(reviews.map((review) => [review.id, shortName(review.authorName)]));
  return views.map((view) => {
    const author = names.get(String(view.input.reviewId ?? ""));
    return author ? { ...view, details: { ...view.details, author } } : view;
  });
}

export async function pendingActions(shopId: string, now = new Date()) {
  const rows = await db.mcpAction.findMany({
    where: { shopId, status: "pending", expiresAt: { gt: now } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return withAuthors(
    shopId,
    rows.map((row) => viewOf(row, now)),
  );
}

export async function recentActions(
  shopId: string,
  options: { status?: ActionStatus; take?: number } = {},
  now = new Date(),
) {
  const rows = await db.mcpAction.findMany({
    where: {
      shopId,
      ...(options.status === "expired"
        ? { OR: [{ status: "expired" }, { status: "pending", expiresAt: { lte: now } }] }
        : options.status === "pending"
          ? { status: "pending", expiresAt: { gt: now } }
          : options.status
            ? { status: options.status }
            : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 20,
  });
  return withAuthors(
    shopId,
    rows.map((row) => viewOf(row, now)),
  );
}

export type DecideResult =
  | { ok: true; status: "done" | "rejected" }
  | { ok: false; error: "not_found" | "decided" | "expired" | "failed"; message?: string };

/** অ্যাপের পাতা থেকে: অনুমোদন (কাজটা এখনই হয়) বা বাতিল */
export async function decideAction(
  admin: GraphqlClient,
  shop: { id: string; plan: string | null },
  actionId: string,
  approve: boolean,
  now = new Date(),
): Promise<DecideResult> {
  const action = await db.mcpAction.findFirst({ where: { id: actionId, shopId: shop.id } });
  if (!action) return { ok: false, error: "not_found" };
  if (action.status !== "pending") return { ok: false, error: "decided" };
  if (action.expiresAt <= now) {
    await db.mcpAction.updateMany({
      where: { id: action.id, status: "pending" },
      data: { status: "expired", decidedAt: now },
    });
    return { ok: false, error: "expired" };
  }
  // দুবার চাপলে বা দুই জায়গা থেকে একসাথে অনুমোদন দিলেও কাজ একবারই হয়
  const claimed = await db.mcpAction.updateMany({
    where: { id: action.id, status: "pending" },
    data: { status: approve ? "running" : "rejected", decidedAt: now },
  });
  if (claimed.count === 0) return { ok: false, error: "decided" };
  if (!approve) return { ok: true, status: "rejected" };
  try {
    await runAction(admin, shop, action.tool, action.input);
    await db.mcpAction.update({ where: { id: action.id }, data: { status: "done" } });
    return { ok: true, status: "done" };
  } catch (error) {
    const known = error instanceof McpToolError || error instanceof ToolError;
    if (!known) console.error("[mcp] approved change failed", error);
    const message = known
      ? error.message
      : "Something went wrong while making this change. Try again from the assistant.";
    await db.mcpAction.update({
      where: { id: action.id },
      data: { status: "failed", error: message.slice(0, 500) },
    });
    return { ok: false, error: "failed", message };
  }
}

async function runAction(
  admin: GraphqlClient,
  shop: { id: string; plan: string | null },
  tool: string,
  input: unknown,
) {
  const plan = planOf(shop);
  if (tool === "request_feature_change") {
    const args = featureChangeInput.parse(input);
    await saveTool(admin, { id: shop.id, plan }, args.featureId, { enabled: args.enabled });
    return;
  }
  if (tool === "request_offer_change") {
    const args = offerChangeInput.parse(input);
    const offer = await getOffer(shop.id, args.offerId);
    if (!offer) throw new McpToolError("This offer no longer exists.");
    await db.offer.update({ where: { id: offer.id }, data: { active: args.active } });
    await syncStoreConfig(admin, { id: shop.id, plan });
    return;
  }
  if (tool === "request_review_change") {
    const args = reviewChangeInput.parse(input);
    const review = await db.review.findFirst({
      where: { id: args.reviewId, shopId: shop.id },
      select: { id: true },
    });
    if (!review) throw new McpToolError("This review no longer exists.");
    if (args.action === "reply") {
      await moderate(shop.id, [review.id], { type: "reply", reply: args.reply ?? "" });
      return;
    }
    const status = args.action === "publish" ? "published" : "rejected";
    const changed = await moderate(shop.id, [review.id], { type: "status", status });
    // থিমের স্টার আর AI রিভিউ সারাংশ, অ্যাপের রিভিউ পাতার মতোই
    await Promise.all(
      changed.products.map((productId) =>
        syncProductRating(admin, shop.id, productId).catch((error: unknown) =>
          console.warn("[mcp] rating sync failed", error),
        ),
      ),
    );
    await queueSummaryRefresh(shop.id, changed.products).catch((error: unknown) =>
      console.warn("[mcp] summary refresh failed", error),
    );
    return;
  }
  throw new McpToolError("Unknown request.");
}
