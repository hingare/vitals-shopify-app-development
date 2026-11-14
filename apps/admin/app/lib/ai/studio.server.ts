import type { Prisma } from "@prisma/client";
import { canUseTool } from "@app/tool-sdk";
import { registry } from "@app/tools";
import db from "../../db.server";
import { MICROS_PER_CREDIT } from "../plans";
import { readUsage, type UsageShop } from "../usage.server";
import { aiConfigured } from "./claude.server";
import { brandSchema, readBrand } from "./brand";
import { aiTaskFor, recentGenerations } from "./generations.server";

/** AI পেজে টুলগুলোর দল আর ক্রম */
export const AI_TOOL_GROUPS = {
  write: [
    "ai-descriptions",
    "ai-alt-text",
    "ai-product-faq",
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
  }));
}

export type GenerationView = Awaited<ReturnType<typeof generationList>>[number];
