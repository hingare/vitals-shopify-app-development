import db from "../db.server";
import { startDueCampaigns } from "./campaigns.server";
import { queueWinbacks } from "./flows.server";
import { processMessages, recoverStuckMessages } from "./messages.server";
import { claimJob, recoverStuckJobs, runJob } from "./queue.server";
import { measure, primaryDomainUrl, saveSnapshot } from "./speed.server";
import { pruneVisitorDays } from "./store-analytics.server";
import type { GraphqlClient } from "./tools.server";
// এই ফাইলগুলো নিজেদের ব্যাকগ্রাউন্ড কাজ (registerJob) নথিভুক্ত করে, তাই সার্ভার চালুর সময়ই আনতে হয়
import "./integrations.server";
import "./push.server";
import "./seo-alt.server";
import "./stock-alerts.server";
import "./subscribers.server";

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

/** পুরনো, আর কাজে লাগে না এমন সারি মুছে ফেলে (ক্রেতার তথ্য অকারণে জমিয়ে রাখা হয় না) */
export async function pruneMarketingData(now = new Date()) {
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  await db.abandonedCheckout.deleteMany({ where: { createdAt: { lt: daysAgo(30) } } });
  await db.job.deleteMany({
    where: { status: { in: ["done", "failed"] }, finishedAt: { lt: daysAgo(14) } },
  });
  // বার্তার ইতিহাস ১৮০ দিন (রিপোর্টের জন্য যথেষ্ট)
  await db.message.deleteMany({ where: { createdAt: { lt: daysAgo(180) } } });
}

let running = 0;
let runningJobs = 0;
let sending = false;
let lastHousekeeping = 0;
let lastMinute = 0;
let lastWinback = 0;

/** প্রতিটা পালায় আলাদা try: একটা অংশ ভাঙলেও বাকিগুলো চলে */
async function step(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    console.error(`[jobs] ${name} failed`, error);
  }
}

async function tick() {
  const now = Date.now();
  if (now - lastHousekeeping > 60 * 60_000) {
    lastHousekeeping = now;
    await step("housekeeping", async () => {
      await recoverStuck();
      await recoverStuckJobs();
      await recoverStuckMessages();
      await pruneVisitorDays();
      await pruneMarketingData();
    });
  }
  if (now - lastMinute > 60_000) {
    lastMinute = now;
    await step("campaigns", () => startDueCampaigns());
  }
  if (now - lastWinback > 6 * 60 * 60_000) {
    lastWinback = now;
    await step("winback", () => queueWinbacks());
  }

  await step("speed", async () => {
    while (running < MAX_PARALLEL) {
      const job = await claim();
      if (!job) break;
      running++;
      void runSpeedJob(job).finally(() => {
        running--;
      });
    }
  });

  await step("queue", async () => {
    while (runningJobs < MAX_PARALLEL) {
      const job = await claimJob();
      if (!job) break;
      runningJobs++;
      void runJob(job).finally(() => {
        runningJobs--;
      });
    }
  });

  // ইমেইল: আগের ব্যাচ শেষ না হলে নতুন ব্যাচ ধরা হয় না
  if (!sending) {
    sending = true;
    void step("messages", () => processMessages()).finally(() => {
      sending = false;
    });
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
  lastMinute = 0;
  // সার্ভার চালুর সাথে সাথে নয়, একটু পরে (ডেভেলপমেন্টে বারবার restart হয়)
  lastWinback = Date.now() - 6 * 60 * 60_000 + 5 * 60_000;
  setInterval(() => void tick(), TICK_MS).unref();
}
