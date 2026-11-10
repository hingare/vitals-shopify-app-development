import type { Prisma } from "@prisma/client";
import db from "../db.server";

/**
 * সাধারণ ব্যাকগ্রাউন্ড কাজের লাইন (ডাটাবেসে, "FOR UPDATE SKIP LOCKED" দিয়ে)।
 * বড় কাজ (হাজারো গ্রাহককে ক্যাম্পেইন, সব প্রোডাক্টের alt লেখা) ছোট ছোট ধাপে চলে:
 * handler একটা ধাপ করে `{ again: true, payload }` ফেরত দিলে বাকিটা পরের পালায় চলে,
 * তাই সার্ভার বন্ধ হলেও কাজ যেখানে থেমেছিল সেখান থেকেই শুরু হয়।
 */
export interface JobContext {
  id: string;
  shopId: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export type JobResult = void | {
  again?: boolean;
  payload?: Record<string, unknown>;
  progress?: Record<string, unknown>;
  delayMs?: number;
};

type Handler = (job: JobContext) => Promise<JobResult>;

const handlers = new Map<string, Handler>();
const MAX_ATTEMPTS = 3;
const STUCK_MS = 10 * 60_000;

export function registerJob(kind: string, handler: Handler) {
  handlers.set(kind, handler);
}

export async function enqueueJob(
  shopId: string,
  kind: string,
  payload: Record<string, unknown> = {},
  options: { runAt?: Date; unique?: boolean } = {},
) {
  if (options.unique) {
    const active = await db.job.findFirst({
      where: { shopId, kind, status: { in: ["pending", "running"] } },
    });
    if (active) return active;
  }
  return db.job.create({
    data: {
      shopId,
      kind,
      payload: payload as Prisma.InputJsonValue,
      runAt: options.runAt ?? new Date(),
    },
  });
}

export function latestJob(shopId: string, kind: string) {
  return db.job.findFirst({ where: { shopId, kind }, orderBy: { createdAt: "desc" } });
}

export async function claimJob(): Promise<JobContext | null> {
  const rows = await db.$queryRaw<JobContext[]>`
    UPDATE "Job" SET status = 'running', "startedAt" = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "Job" WHERE status = 'pending' AND "runAt" <= now()
      ORDER BY "runAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "shopId", kind, payload, attempts`;
  return rows[0] ?? null;
}

export async function runJob(job: JobContext) {
  const handler = handlers.get(job.kind);
  try {
    if (!handler) throw new Error(`No handler for job "${job.kind}"`);
    const result = (await handler(job)) ?? {};
    const progress = result.progress as Prisma.InputJsonValue | undefined;
    if (result.again) {
      await db.job.update({
        where: { id: job.id },
        data: {
          status: "pending",
          // ধাপ এগিয়েছে, তাই চেষ্টার হিসাব নতুন করে শুরু
          attempts: 0,
          error: null,
          runAt: new Date(Date.now() + (result.delayMs ?? 0)),
          payload: (result.payload ?? job.payload) as Prisma.InputJsonValue,
          ...(progress ? { progress } : {}),
        },
      });
      return;
    }
    await db.job.update({
      where: { id: job.id },
      data: {
        status: "done",
        finishedAt: new Date(),
        error: null,
        ...(progress ? { progress } : {}),
      },
    });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const retry = job.attempts < MAX_ATTEMPTS;
    await db.job.update({
      where: { id: job.id },
      data: retry
        ? { status: "pending", error: message, runAt: new Date(Date.now() + job.attempts * 60_000) }
        : { status: "failed", error: message, finishedAt: new Date() },
    });
  }
}

/** সার্ভার বন্ধ হয়ে আটকে থাকা কাজ আবার লাইনে দেয় */
export async function recoverStuckJobs() {
  const cutoff = new Date(Date.now() - STUCK_MS);
  await db.job.updateMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    data: { status: "pending" },
  });
}
