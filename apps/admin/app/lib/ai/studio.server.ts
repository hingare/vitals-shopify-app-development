import type { Prisma } from "@prisma/client";
import { canUseTool } from "@app/tool-sdk";
import { registry } from "@app/tools";
import db from "../../db.server";
import { MICROS_PER_CREDIT } from "../plans";
import { readUsage, type UsageShop } from "../usage.server";
import { aiConfigured } from "./claude.server";
import { brandSchema, readBrand } from "./brand";
import { aiTaskFor, recentGenerations } from "./generations.server";
import { extForMime, signMediaPath } from "./media/files.server";
import { mediaOutput } from "./media/output";

/** AI পেজে টুলগুলোর দল আর ক্রম */
export const AI_TOOL_GROUPS = {
  write: [
    "ai-descriptions",
    "ai-alt-text",
    "ai-product-faq",
    "ai-review-summary",
    "ai-social-posts",
    "ai-page-builder",
    "ai-product-importer",
  ],
  grow: ["ai-marketing-plan", "ai-viral-campaign", "ai-page-audit"],
  media: [
    "ai-background-remover",
    "ai-image-enhancer",
    "ai-photoshoots",
    "ai-image-to-video",
    "ai-video-ads",
  ],
} as const;

/** মার্চেন্ট দেখেন পুরো ক্রেডিটে (উপরের দিকে গোল), ভেতরে হিসাব মাইক্রো-ডলারে */
export const toCredits = (micros: number) => Math.ceil(micros / MICROS_PER_CREDIT);

export async function aiCredits(shop: UsageShop) {
  const usage = await readUsage(shop, "ai");
  return {
    used: toCredits(usage.used),
    limit: Math.floor(usage.limit / MICROS_PER_CREDIT),
    left: Math.floor(usage.left / MICROS_PER_CREDIT),
    trial: usage.trial,
    resetsAt: usage.resetsAt.toISOString(),
  };
}

export async function studioOverview(shop: UsageShop & { aiSettings?: unknown }) {
  const plan = shop.plan === "starter" || shop.plan === "professional" ? shop.plan : null;
  const tools = Object.entries(AI_TOOL_GROUPS).map(([group, ids]) => ({
    group,
    tools: ids.map((id) => {
      const tool = registry.get(id);
      return {
        id,
        allowed: Boolean(tool && plan && canUseTool(tool, plan)),
        // ছবি আর ভিডিওর কাজ এখনো তৈরি হয়নি এমন হলে "শীঘ্রই" দেখায়
        ready: Boolean(aiTaskFor(id)),
      };
    }),
  }));
  return {
    configured: aiConfigured(),
    professional: plan === "professional",
    credits: await aiCredits(shop),
    brand: readBrand(shop.aiSettings),
    groups: tools,
  };
}

export async function saveBrand(shopId: string, value: unknown) {
  const parsed = brandSchema.safeParse(value);
  if (!parsed.success) return false;
  await db.shop.update({
    where: { id: shopId },
    data: { aiSettings: parsed.data as Prisma.InputJsonValue },
  });
  return true;
}

const numericId = (gid: unknown) =>
  typeof gid === "string" ? (/\/(\d+)$/.exec(gid)?.[1] ?? null) : null;

/** কাজটা যে জিনিস নিয়ে (বা বসানোর পর যা তৈরি হলো), Shopify অ্যাডমিনে সেটা খোলার ঠিকানা */
export function adminLinkFor(row: {
  toolId: string;
  status: string;
  input: unknown;
  previous: unknown;
}): string | null {
  const input = (row.input ?? {}) as Record<string, unknown>;
  const previous = (row.previous ?? {}) as Record<string, unknown>;
  if (row.toolId === "ai-product-importer") {
    const id = row.status === "applied" ? numericId(previous.productId) : null;
    return id ? `shopify://admin/products/${id}` : null;
  }
  if (row.toolId === "ai-page-builder") {
    const id = row.status === "applied" ? numericId(previous.pageId) : null;
    return id ? `shopify://admin/pages/${id}` : null;
  }
  const productId = numericId(input.productId);
  return productId ? `shopify://admin/products/${productId}` : null;
}

/**
 * ছবি ও ভিডিওর ফল দেখানোর জন্য সই করা ঠিকানা (কয়েক ঘণ্টা চলে; পেজ নতুন করে খুললে নতুন ঠিকানা)।
 * ৩০ দিন পেরিয়ে ফাইল মুছে গেলে শুধু "মেয়াদ শেষ"।
 */
export function mediaViews(row: { id: string; toolId: string; output: unknown }) {
  if (!(AI_TOOL_GROUPS.media as readonly string[]).includes(row.toolId) || !row.output) return null;
  const parsed = mediaOutput.safeParse(row.output);
  if (!parsed.success) return null;
  if (parsed.data.expired) return { expired: true, files: [] };
  const tool = row.toolId.replace(/^ai-/, "");
  return {
    expired: false,
    files: parsed.data.files.map((file, index) => {
      const name = `${tool}-${row.id.slice(-6)}-${index + 1}.${extForMime(file.mime)}`;
      return {
        type: file.type,
        name,
        url: signMediaPath(file.key),
        download: signMediaPath(file.key, { download: name }),
        width: file.width,
        height: file.height,
        bytes: file.bytes,
      };
    }),
  };
}

export async function generationList(shopId: string, toolId: string) {
  const rows = await recentGenerations(shopId, toolId, 30);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    error: row.error,
    label: row.label,
    input: row.input as Record<string, unknown>,
    output: row.output as Record<string, unknown> | null,
    credits: toCredits(row.costMicros),
    createdAt: row.createdAt.toISOString(),
    canApply: Boolean(aiTaskFor(row.toolId)?.apply),
    canUndo: Boolean(aiTaskFor(row.toolId)?.undo),
    adminLink: adminLinkFor(row),
    media: mediaViews(row),
  }));
}

export type GenerationView = Awaited<ReturnType<typeof generationList>>[number];
