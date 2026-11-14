import { randomUUID } from "node:crypto";
import { registry } from "@app/tools";
import { canUseTool } from "@app/tool-sdk";
import { z } from "zod";
import db from "../../db.server";
import { gql } from "../admin-client.server";
import type { GraphqlClient } from "../tools.server";
import { readUsage } from "../usage.server";
import { aiConfigured } from "./claude.server";
import { AiError, asAiError, type AiErrorCode } from "./errors";
import {
  aiTaskFor,
  applyGeneration,
  assertToolAllowed,
  discardGeneration,
  startGeneration,
  undoGeneration,
  type AiShop,
} from "./generations.server";
import { falConfigured } from "./media/fal.server";
import { mediaStorageReady } from "./media/files.server";
import {
  AD_COPY_ESTIMATE,
  BACKGROUND_PRICE,
  EXPAND_PRICE,
  PRODUCT_SHOT_PRICE,
  UPSCALE_MAX_MICROS,
  alreadyShape,
  upscaleAllowed,
  videoPrice,
  type ExpandShape,
  type MediaPrices,
} from "./media/models";
import { loadProduct, smallImage } from "./product.server";
import { AI_TOOL_GROUPS, aiCredits, generationList, toCredits } from "./studio.server";
import { imageGid, productGid } from "./tasks/common.server";
import { startReviewSummaries } from "./tasks/review-summary.server";

/** AI পেজের প্রতিটা টুলের নিজস্ব পাতা (/app/ai/<id>): শুরু করা, ফল দেখা, বসানো, ফেরানো */
const STUDIO_TOOLS = new Set<string>(Object.values(AI_TOOL_GROUPS).flat());

export const isStudioTool = (toolId: string) => STUDIO_TOOLS.has(toolId);

/** ছবি ও ভিডিওর টুল: fal.ai আর ফাইল রাখার জায়গা লাগে */
const MEDIA_TOOLS = new Set<string>(AI_TOOL_GROUPS.media);

/** টুলটা চালানোর মতো সব চাবি আর জায়গা আছে কিনা */
export function toolConfigured(toolId: string): boolean {
  if (!MEDIA_TOOLS.has(toolId)) return aiConfigured();
  const media = falConfigured() && mediaStorageReady();
  // বিজ্ঞাপনের লেখা Claude লেখে
  return toolId === "ai-video-ads" ? media && aiConfigured() : media;
}

/** ছবি ও ভিডিওর টুলের দাম, ক্রেডিটে (ফর্মে শুরুর আগেই দেখানো হয়) */
export function mediaPrices(toolId: string): MediaPrices | null {
  const video = (extra: number) => {
    const short = videoPrice("short");
    const long = videoPrice("long");
    if (!short || !long) return null;
    return {
      credits: { short: toCredits(short.micros + extra), long: toCredits(long.micros + extra) },
      seconds: { short: short.seconds, long: long.seconds },
    };
  };
  switch (toolId) {
    case "ai-background-remover":
      return { credits: { image: toCredits(BACKGROUND_PRICE) }, seconds: null };
    case "ai-image-enhancer":
      return {
        credits: { upscale: toCredits(UPSCALE_MAX_MICROS), expand: toCredits(EXPAND_PRICE) },
        seconds: null,
      };
    case "ai-photoshoots":
      return { credits: { image: toCredits(PRODUCT_SHOT_PRICE) }, seconds: null };
    case "ai-image-to-video":
      return video(0);
    case "ai-video-ads":
      return video(AD_COPY_ESTIMATE);
    default:
      return null;
  }
}

/** যেসব AI টুলের ফল স্টোরে দেখাতে টুলটা চালু থাকতে হয় */
const STOREFRONT_TOOLS = new Set(["ai-product-faq", "ai-review-summary"]);

/** একবারে কতগুলো ফল একসাথে বসানো যায় ("সব বসান") */
const APPLY_ALL_LIMIT = 50;

async function primaryUrl(admin: GraphqlClient): Promise<string> {
  try {
    const data = await gql<{ shop: { primaryDomain: { url: string } } }>(
      admin,
      `#graphql
        query AiPrimaryUrl { shop { primaryDomain { url } } }`,
    );
    return data.shop.primaryDomain.url;
  } catch {
    return "";
  }
}

export async function toolPageData(shop: AiShop, admin: GraphqlClient, toolId: string) {
  const tool = registry.get(toolId);
  if (!tool || !isStudioTool(toolId)) throw new Response("Not found", { status: 404 });
  const plan = shop.plan === "starter" || shop.plan === "professional" ? shop.plan : null;
  const allowed = plan !== null && canUseTool(tool, plan);
  // FAQ আর রিভিউর সারাংশ স্টোরে দেখাতে টুলটা চালু থাকতে হয়; বন্ধ থাকলে পেজে মনে করিয়ে দেওয়া হয়
  const storefrontOff =
    STOREFRONT_TOOLS.has(toolId) &&
    !(await db.toolSetting.findFirst({ where: { shopId: shop.id, toolId, enabled: true } }));
  return {
    id: toolId,
    storefrontOff,
    ready: Boolean(aiTaskFor(toolId)),
    allowed,
    configured: toolConfigured(toolId),
    media: mediaPrices(toolId),
    credits: await aiCredits(shop),
    storeUrl: toolId === "ai-page-audit" && allowed ? await primaryUrl(admin) : "",
    generations: allowed ? await generationList(shop.id, toolId) : [],
  };
}

const altStart = z.object({ productId: productGid, onlyMissing: z.boolean().default(true) });

/**
 * Alt Text একটা প্রোডাক্টের প্রতিটা ছবির জন্য আলাদা কাজ বানায় (এক ব্যাচে), যাতে মার্চেন্ট প্রতিটা দেখে বসাতে পারেন।
 * "শুধু alt নেই এমন" বাছলে যেগুলোর alt আছে সেগুলো বাদ যায়। কতগুলো কাজ লাইনে পড়ল তা ফেরত দেয়।
 */
export async function startAltText(shop: AiShop, admin: GraphqlClient, raw: unknown) {
  assertToolAllowed(shop, "ai-alt-text");
  const parsed = altStart.safeParse(raw);
  if (!parsed.success) throw new AiError("invalid", parsed.error.message);
  const product = await loadProduct(admin, parsed.data.productId);
  const images = product.images.filter((image) => !parsed.data.onlyMissing || !image.alt.trim());
  const batchId = randomUUID();
  for (const image of images) {
    const position = product.images.indexOf(image) + 1;
    await startGeneration(
      shop,
      "ai-alt-text",
      { productId: product.id, mediaId: image.id, imageUrl: smallImage(image.url, 240) },
      { targetId: image.id, batchId, label: `${product.title} · #${position}` },
    );
  }
  return images.length;
}

const mediaStart = z
  .object({ productId: productGid, mediaIds: z.array(imageGid).min(1).max(10) })
  .passthrough();

/**
 * ছবি ও ভিডিওর কাজ শুরু: বাছা প্রতিটা ছবির জন্য আলাদা কাজ (এক ব্যাচে)। পটভূমি সরানোয় একসাথে কয়েকটা ছবি
 * নেওয়া যায়, বাকিগুলোয় একটা। শুরুর আগে মোট আনুমানিক খরচের মতো ক্রেডিট বাকি আছে কিনা দেখা হয়।
 */
export async function startMediaBatch(
  shop: AiShop,
  admin: GraphqlClient,
  toolId: string,
  raw: unknown,
) {
  assertToolAllowed(shop, toolId);
  const task = aiTaskFor(toolId);
  if (!task) throw new AiError("failed", `No AI task for ${toolId}`);
  const parsed = mediaStart.safeParse(raw);
  if (!parsed.success) throw new AiError("invalid", parsed.error.message);
  const { productId, mediaIds, ...options } = parsed.data;
  const ids = [...new Set(mediaIds)];
  if (toolId !== "ai-background-remover" && ids.length > 1) {
    throw new AiError("invalid", "Choose one image");
  }
  const product = await loadProduct(admin, productId);
  const images = ids.map((id) => product.images.find((image) => image.id === id));
  const inputs: unknown[] = [];
  let estimate = 0;
  for (const image of images) {
    if (!image) throw new AiError("not_found", "Image");
    const input = task.input.safeParse({
      ...options,
      productId: product.id,
      mediaId: image.id,
      imageUrl: smallImage(image.url, 240),
    });
    if (!input.success) throw new AiError("invalid", input.error.message);
    if (toolId === "ai-image-enhancer") {
      const { mode, shape } = input.data as { mode: string; shape: ExpandShape };
      if (mode === "upscale" ? !upscaleAllowed(image) : alreadyShape(image, shape)) {
        throw new AiError("invalid", "Nothing to change in this image");
      }
    }
    inputs.push(input.data);
    estimate += task.estimateMicros?.(input.data) ?? 0;
  }
  await assertCanStart(shop, toolId, estimate);
  const batchId = randomUUID();
  for (const [index, image] of images.entries()) {
    if (!image) continue;
    await startGeneration(shop, toolId, inputs[index], {
      targetId: image.id,
      batchId,
      label: `${product.title} · #${product.images.indexOf(image) + 1}`,
    });
  }
  return images.length;
}

const actionBody = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("start"),
    input: z.unknown(),
    label: z.string().max(500).optional(),
  }),
  z.object({ intent: z.literal("apply"), id: z.string(), output: z.unknown().optional() }),
  z.object({
    intent: z.literal("applyAll"),
    edits: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({ intent: z.literal("undo"), id: z.string() }),
  z.object({ intent: z.literal("discard"), id: z.string() }),
  z.object({ intent: z.literal("retry"), id: z.string() }),
]);

export type ToolActionResult =
  | { ok: true; intent: string; count: number; failed: number }
  | { ok: false; intent: string; error: AiErrorCode | "nothing" };

const done = (intent: string, count = 1, failed = 0): ToolActionResult => ({
  ok: true,
  intent,
  count,
  failed,
});

/** নতুন কাজ শুরুর আগে: চাবি আছে কিনা আর এ মাসে ক্রেডিট বাকি আছে কিনা (জানা থাকলে আনুমানিক খরচের মতো) */
async function assertCanStart(shop: AiShop, toolId: string, needMicros = 1) {
  if (!toolConfigured(toolId)) throw new AiError("not_configured");
  const usage = await readUsage(shop, "ai");
  if (usage.left <= 0 || usage.left < needMicros) throw new AiError("budget");
}

export async function handleToolAction(
  shop: AiShop,
  admin: GraphqlClient,
  toolId: string,
  raw: unknown,
): Promise<ToolActionResult> {
  const parsed = actionBody.safeParse(raw);
  if (!parsed.success || !isStudioTool(toolId)) {
    return { ok: false, intent: "unknown", error: "invalid" };
  }
  const body = parsed.data;
  try {
    switch (body.intent) {
      case "start": {
        if (MEDIA_TOOLS.has(toolId)) {
          const count = await startMediaBatch(shop, admin, toolId, body.input);
          return done(body.intent, count);
        }
        await assertCanStart(shop, toolId);
        if (toolId === "ai-alt-text" || toolId === "ai-review-summary") {
          const count =
            toolId === "ai-alt-text"
              ? await startAltText(shop, admin, body.input)
              : await startReviewSummaries(shop, admin, body.input);
          return count > 0
            ? done(body.intent, count)
            : { ok: false, intent: body.intent, error: "nothing" };
        }
        await startGeneration(shop, toolId, body.input, { label: body.label ?? null });
        return done(body.intent);
      }
      case "retry": {
        const row = await db.aiGeneration.findFirst({
          where: { id: body.id, shopId: shop.id, toolId, status: "failed" },
        });
        if (!row) throw new AiError("not_found");
        const task = aiTaskFor(toolId);
        const input = task?.input.safeParse(row.input);
        await assertCanStart(
          shop,
          toolId,
          input?.success ? (task?.estimateMicros?.(input.data) ?? 1) : 1,
        );
        await startGeneration(shop, toolId, row.input, {
          targetId: row.targetId,
          batchId: row.batchId,
          label: row.label,
        });
        await discardGeneration(shop, row.id);
        return done(body.intent);
      }
      case "apply":
        await applyGeneration(shop, admin, body.id, body.output);
        return done(body.intent);
      case "applyAll": {
        const rows = await db.aiGeneration.findMany({
          where: { shopId: shop.id, toolId, status: "ready" },
          orderBy: { createdAt: "asc" },
          take: APPLY_ALL_LIMIT,
        });
        let count = 0;
        let failed = 0;
        for (const row of rows) {
          try {
            await applyGeneration(shop, admin, row.id, body.edits[row.id]);
            count++;
          } catch (error) {
            const aiError = asAiError(error);
            if (aiError.code === "failed") console.error(`[ai] apply ${toolId}`, aiError.message);
            failed++;
          }
        }
        return count + failed > 0
          ? done(body.intent, count, failed)
          : { ok: false, intent: body.intent, error: "nothing" };
      }
      case "undo":
        await undoGeneration(shop, admin, body.id);
        return done(body.intent);
      case "discard":
        await discardGeneration(shop, body.id);
        return done(body.intent);
    }
  } catch (error) {
    const aiError = asAiError(error);
    if (aiError.code === "failed") console.error(`[ai] ${toolId} ${body.intent}`, aiError.message);
    return { ok: false, intent: body.intent, error: aiError.code };
  }
}
