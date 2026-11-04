import db from "../db.server";
import { measure, primaryDomainUrl, saveSnapshot } from "./speed.server";
import { pruneVisitorDays } from "./store-analytics.server";
import type { GraphqlClient } from "./tools.server";

/**
 * ছোট ব্যাকগ্রাউন্ড কাজের ব্যবস্থা, ডাটাবেস দিয়ে (আলাদা Redis লাগে না)।
 * একাধিক সার্ভার চললেও "FOR UPDATE SKIP LOCKED" একই কাজ দুবার চালাতে দেয় না।
 */
const TICK_MS = 3_000;
const MAX_PARALLEL = 2;
const STUCK_MS = 5 * 60_000;
const MAX_ATTEMPTS = 2;

/** দোকানের জন্য Speed Guard মাপ লাইনে দেয়; আগেরটা চলতে থাকলে সেটাই ফেরত দেয়। */
export async function enqueueSpeedCheck(admin: GraphqlClient, shopId: string) {
  const active = await db.speedJob.findFirst({
    where: { shopId, status: { in: ["pending", "running"] } },
  });
  if (active) return active;
  const url = await primaryDomainUrl(admin);
  const job = await db.speedJob.create({ data: { shopId, url } });
  void tick();
  return job;
}

/** স্টোরের সর্বশেষ মাপের কাজ (পেজে "মাপা হচ্ছে" বা ত্রুটি দেখাতে) */
export function latestSpeedJob(shopId: string) {
  return db.speedJob.findFirst({ where: { shopId }, orderBy: { createdAt: "desc" } });
}

interface ClaimedJob {
  id: string;
  shopId: string;
  url: string;
  attempts: number;
}

async function claim(): Promise<ClaimedJob | null> {
  const rows = await db.$queryRaw<ClaimedJob[]>`
    UPDATE "SpeedJob" SET status = 'running', "startedAt" = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "SpeedJob" WHERE status = 'pending'
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "shopId", url, attempts`;
  return rows[0] ?? null;
}

export async function runSpeedJob(job: ClaimedJob, measureFn = measure) {
  try {
    const result = await measureFn(job.url);
    await saveSnapshot(job.shopId, job.url, result);
    await db.speedJob.update({
      where: { id: job.id },
      data: { status: "done", finishedAt: new Date(), error: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retry = job.attempts < MAX_ATTEMPTS;
    await db.speedJob.update({
      where: { id: job.id },
      data: retry
        ? { status: "pending", error: message }
        : { status: "failed", error: message, finishedAt: new Date() },
    });
  }
}

/** সার্ভার বন্ধ হয়ে আটকে থাকা কাজ আবার লাইনে দেয় বা ব্যর্থ ধরে */
async function recoverStuck() {
  const cutoff = new Date(Date.now() - STUCK_MS);
  await db.speedJob.updateMany({
    where: { status: "running", startedAt: { lt: cutoff }, attempts: { lt: MAX_ATTEMPTS } },
    data: { status: "pending" },
  });
  await db.speedJob.updateMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    data: { status: "failed", error: "Timed out", finishedAt: new Date() },
  });
}

let running = 0;
let lastHousekeeping = 0;

async function tick() {
  try {
    if (Date.now() - lastHousekeeping > 60 * 60_000) {
      lastHousekeeping = Date.now();
      await recoverStuck();
      await pruneVisitorDays();
    }
    while (running < MAX_PARALLEL) {
      const job = await claim();
      if (!job) break;
      running++;
      void runSpeedJob(job).finally(() => {
        running--;
      });
    }
  } catch (error) {
    console.error("[jobs] tick failed", error);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __appJobsStarted: boolean | undefined;
}

/** সার্ভার চালু হলে একবার ডাকা হয় (dev-এ hot reload-এও একবারই) */
export function startJobs() {
  if (globalThis.__appJobsStarted || process.env.DISABLE_JOBS === "true") return;
  globalThis.__appJobsStarted = true;
  lastHousekeeping = 0;
  setInterval(() => void tick(), TICK_MS).unref();
}
