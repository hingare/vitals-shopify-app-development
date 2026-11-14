import type { Prisma } from "@prisma/client";
import { canUseTool, type AnyTool } from "@app/tool-sdk";
import { registry } from "@app/tools";
import type { z } from "zod";
import db from "../../db.server";
import { offlineAdmin } from "../admin-client.server";
import { enqueueJob, registerJob, type JobContext, type JobResult } from "../queue.server";
import type { GraphqlClient } from "../tools.server";
import { AiError, asAiError } from "./errors";

/**
 * AI দিয়ে বানানো প্রতিটা কাজের জীবন:
 *   queued → running → ready (মার্চেন্ট দেখেন, চাইলে বদলান) → applied (স্টোরে বসল) → undone (আগের মানে ফিরল)
 *   যেকোনো ধাপে failed (ত্রুটির ধরনসহ) বা discarded (মার্চেন্ট ফেলে দিলেন)।
 * AI ডাকটা ব্যাকগ্রাউন্ডে চলে ("ai:<id>" কাজ, আলাদা লাইনে), তাই পেজ আটকে থাকে না আর সার্ভার
 * বন্ধ হলেও কাজ হারায় না। স্টোরে বসানো আর ফেরানো হয় মার্চেন্টের ক্লিকে, তাঁর নিজের অনুরোধে।
 */
export const GENERATION_STATUSES = [
  "queued",
  "running",
  "ready",
  "applying",
  "applied",
  "undoing",
  "undone",
  "failed",
  "discarded",
] as const;

export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export interface AiShop {
  id: string;
  domain: string;
  plan: string | null;
  trialEndsAt?: Date | null;
}

export interface AiTaskContext<I> {
  shop: AiShop;
  admin: GraphqlClient;
  input: I;
  targetId: string | null;
  /** কাজের id (ছবি ও ভিডিওর কাজ নিজের ফাইলের নাম এটা দিয়ে রাখে) */
  generationId?: string;
  /** লম্বা কাজের আগের পালায় রেখে যাওয়া অবস্থা (প্রথম পালায় null) */
  pending?: Record<string, unknown> | null;
}

export interface AiRunResult<O> {
  output: O;
  costMicros: number;
  model: string;
}

/**
 * লম্বা কাজ (বাইরের সার্ভিসে ছবি বা ভিডিও বানানো) ফলের বদলে এটা ফেরত দিতে পারে: লাইন অবস্থাটা রেখে
 * `delayMs` পরে আবার `run` ডাকে, `pending`-এ সেই অবস্থা দিয়ে। এর মধ্যে কোনো কর্মী আটকে থাকে না।
 */
export interface AiPendingResult {
  pending: Record<string, unknown>;
  delayMs: number;
  /** এই পালায় যা খরচ হয়ে গেছে (যেমন বিজ্ঞাপনের লেখা), ফলের পাশে দেখানোর জন্য */
  costMicros?: number;
}

export const isPendingResult = (value: unknown): value is AiPendingResult =>
  Boolean(value && typeof value === "object" && "pending" in value);

export interface AiTask<I = unknown, O = unknown> {
  toolId: string;
  /** মার্চেন্টের দেওয়া ইনপুট */
  input: z.ZodType<I>;
  /** ফলের আকার: মার্চেন্ট বদলে দিলে বসানোর আগে এটা দিয়েই মেলানো হয় */
  output: z.ZodType<O>;
  run(context: AiTaskContext<I>): Promise<AiRunResult<O> | AiPendingResult>;
  /** শুরুর আগে আনুমানিক খরচ (মাইক্রো-ডলারে), এ মাসে এত ক্রেডিট বাকি আছে কিনা দেখতে */
  estimateMicros?(input: I): number;
  /**
   * ফল তৈরি হলেই নিজে থেকে স্টোরে বসে (মার্চেন্ট পরে বদলাতে বা ফেরাতে পারেন)। শুধু সেই টুলে, যেখানে
   * মার্চেন্ট টুল চালু করেই এটা চেয়েছেন (যেমন রিভিউর সারাংশ)।
   */
  autoApply?: boolean;
  /** ফল স্টোরে বসায় আর আগের মান ফেরত দেয় (ফেরানোর জন্য) */
  apply?(context: AiTaskContext<I> & { output: O }): Promise<unknown>;
  undo?(context: AiTaskContext<I> & { output: O; previous: unknown }): Promise<void>;
  /**
   * লম্বা কাজ শেষ পর্যন্ত ব্যর্থ হলে একবার: বাইরের কাজ বাতিল আর নিশ্চিতভাবে না-হওয়া কাজের ধরে রাখা
   * টাকা ফেরত। শুধু আগের পালার রেখে যাওয়া অবস্থা থাকলে ডাকা হয়।
   */
  abandon?(context: { shop: AiShop; pending: Record<string, unknown> }): Promise<void>;
  /** কাজ ফেলে দিলে তার নিজের জিনিস (যেমন রাখা ফাইল) মোছা */
  release?(generationId: string): Promise<void>;
}

const tasks = new Map<string, AiTask>();

export function registerAiTask<I, O>(task: AiTask<I, O>) {
  tasks.set(task.toolId, task as unknown as AiTask);
}

export const aiTaskFor = (toolId: string) => tasks.get(toolId);

/** AI কাজের লাইনের নাম এই দিয়ে শুরু (queue.server.ts এগুলো আলাদা লাইনে চালায়) */
export const AI_JOB_PREFIX = "ai:";
const MAX_AI_ATTEMPTS = 3;

/** প্ল্যানে টুলটা আছে কিনা; না থাকলে "plan" ত্রুটি */
export function assertToolAllowed(shop: AiShop, toolId: string) {
  const tool = registry.get(toolId) as AnyTool | undefined;
  const plan = shop.plan === "starter" || shop.plan === "professional" ? shop.plan : null;
  if (!tool || !plan || !canUseTool(tool, plan)) throw new AiError("plan");
}

export async function startGeneration(
  shop: AiShop,
  toolId: string,
  rawInput: unknown,
  options: { targetId?: string | null; batchId?: string | null; label?: string | null } = {},
) {
  assertToolAllowed(shop, toolId);
  const task = tasks.get(toolId);
  if (!task) throw new AiError("failed", `No AI task for ${toolId}`);
  const parsed = task.input.safeParse(rawInput);
  if (!parsed.success) throw new AiError("invalid", parsed.error.message);
  const generation = await db.aiGeneration.create({
    data: {
      shopId: shop.id,
      toolId,
      targetId: options.targetId ?? null,
      batchId: options.batchId ?? null,
      label: options.label?.trim().slice(0, 255) || null,
      input: parsed.data as Prisma.InputJsonValue,
    },
  });
  await enqueueJob(shop.id, `${AI_JOB_PREFIX}${generation.id}`, { generationId: generation.id });
  return generation;
}

async function setStatus(id: string, data: Prisma.AiGenerationUpdateInput) {
  await db.aiGeneration.update({ where: { id }, data });
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** লম্বা কাজ থামলে বাইরের কাজ বাতিল আর টাকার হিসাব মেলানো; এর ত্রুটি কাজের ফলকে বদলায় না */
async function abandonPending(
  task: AiTask | undefined,
  shop: AiShop | null,
  pending: Record<string, unknown> | null,
) {
  if (!task?.abandon || !shop || !pending) return;
  await task
    .abandon({ shop, pending })
    .catch((error: unknown) => console.warn(`[ai] ${task.toolId} abandon failed`, error));
}

export async function runGenerationJob(job: JobContext): Promise<JobResult> {
  const id = String(job.payload.generationId ?? "");
  const pending = asRecord(job.payload.pending);
  const generation = await db.aiGeneration.findUnique({ where: { id } });
  if (!generation || !["queued", "running"].includes(generation.status)) return;
  const shop = await db.shop.findUnique({ where: { id: generation.shopId } });
  const task = tasks.get(generation.toolId);
  if (!shop || shop.uninstalledAt || !task) {
    await abandonPending(task, shop, pending);
    await setStatus(id, { status: "failed", error: "failed" });
    return;
  }
  await setStatus(id, { status: "running" });
  try {
    // প্ল্যান বদলে গেলে (যেমন Starter-এ নেমে গেলে) লাইনে থাকা কাজও চলে না
    assertToolAllowed(shop, generation.toolId);
    const admin = await offlineAdmin(shop.domain);
    const result = await task.run({
      shop,
      admin,
      input: generation.input,
      targetId: generation.targetId,
      generationId: id,
      pending,
    });
    if (isPendingResult(result)) {
      if (result.costMicros) {
        await setStatus(id, { costMicros: { increment: result.costMicros } });
      }
      return {
        again: true,
        payload: { generationId: id, pending: result.pending },
        delayMs: result.delayMs,
      };
    }
    await setStatus(id, {
      status: "ready",
      output: result.output as Prisma.InputJsonValue,
      costMicros: { increment: result.costMicros },
      model: result.model,
      error: null,
    });
    if (task.autoApply) {
      // বসানো না গেলে ফলটা "ready" থাকে, মার্চেন্ট নিজে বসাতে পারেন
      await applyGeneration(shop, admin, id).catch((error: unknown) =>
        console.warn(`[ai] ${generation.toolId} auto apply failed`, error),
      );
    }
  } catch (error) {
    const aiError = asAiError(error);
    if (aiError.retryable && job.attempts < MAX_AI_ATTEMPTS) {
      // বাইরের কাজ চলতে থাকলে অবস্থা "চলছে"-ই থাকে
      await setStatus(id, { status: pending ? "running" : "queued" });
      // লাইন নিজেই একটু পরে আবার চালায়
      throw aiError;
    }
    if (aiError.code === "failed") {
      console.error(`[ai] ${generation.toolId} failed`, aiError.message);
    }
    await abandonPending(task, shop, pending);
    await setStatus(id, { status: "failed", error: aiError.code });
  }
}

registerJob("ai", runGenerationJob);

async function owned(shop: AiShop, id: string) {
  const generation = await db.aiGeneration.findFirst({ where: { id, shopId: shop.id } });
  if (!generation) throw new AiError("not_found");
  const task = tasks.get(generation.toolId);
  if (!task) throw new AiError("failed", `No AI task for ${generation.toolId}`);
  return { generation, task };
}

/** অবস্থা শুধু `from` থাকলেই বদলায়, তাই একই কাজ দুবার একসাথে বসানো বা ফেরানো যায় না */
async function claim(id: string, from: GenerationStatus[], to: GenerationStatus) {
  const { count } = await db.aiGeneration.updateMany({
    where: { id, status: { in: from } },
    data: { status: to },
  });
  if (count === 0) throw new AiError("not_found");
}

/**
 * ফল স্টোরে বসায়। মার্চেন্ট লেখা বদলে থাকলে `edited` দিয়ে আসে, আর ফলের আকারের সাথে মিলিয়ে তবেই বসে।
 */
export async function applyGeneration(
  shop: AiShop,
  admin: GraphqlClient,
  id: string,
  edited?: unknown,
) {
  const { generation, task } = await owned(shop, id);
  if (!task.apply) throw new AiError("failed", `${generation.toolId} cannot be applied`);
  assertToolAllowed(shop, generation.toolId);
  const parsed = task.output.safeParse(edited === undefined ? generation.output : edited);
  if (!parsed.success) throw new AiError("invalid", parsed.error.message);
  const before = generation.status as GenerationStatus;
  await claim(id, ["ready", "undone"], "applying");
  try {
    const previous = await task.apply({
      shop,
      admin,
      input: generation.input,
      targetId: generation.targetId,
      generationId: id,
      output: parsed.data,
    });
    await setStatus(id, {
      status: "applied",
      output: parsed.data as Prisma.InputJsonValue,
      previous: (previous ?? null) as Prisma.InputJsonValue,
      appliedAt: new Date(),
      error: null,
    });
  } catch (error) {
    await setStatus(id, { status: before });
    throw asAiError(error);
  }
}

export async function undoGeneration(shop: AiShop, admin: GraphqlClient, id: string) {
  const { generation, task } = await owned(shop, id);
  if (!task.undo) throw new AiError("failed", `${generation.toolId} cannot be undone`);
  await claim(id, ["applied"], "undoing");
  try {
    await task.undo({
      shop,
      admin,
      input: generation.input,
      targetId: generation.targetId,
      generationId: id,
      output: generation.output,
      previous: generation.previous,
    });
    await setStatus(id, { status: "undone" });
  } catch (error) {
    await setStatus(id, { status: "applied" });
    throw asAiError(error);
  }
}

/** দেখা ফল ফেলে দেওয়া (তালিকা থেকে সরে যায়); বসানো ফল আগে ফেরাতে হয় */
export async function discardGeneration(shop: AiShop, id: string) {
  const { task } = await owned(shop, id);
  await claim(id, ["ready", "failed", "undone"], "discarded");
  await task
    .release?.(id)
    .catch((error: unknown) => console.warn(`[ai] ${task.toolId} release failed`, error));
}

export function recentGenerations(shopId: string, toolId: string, take = 20) {
  return db.aiGeneration.findMany({
    where: { shopId, toolId, status: { not: "discarded" } },
    orderBy: { createdAt: "desc" },
    take,
  });
}
