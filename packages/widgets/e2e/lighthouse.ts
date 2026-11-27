import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { OFFERS, SCENARIOS, STOREFRONT_TOOLS } from "./scenarios";
import { tls } from "./serve";
import type { StoreOptions } from "./store";

/** মোবাইল Lighthouse দিয়ে একটা পাতা মাপা (e2e/speed.ts) */

/**
 * কম্পিউটারের গতি অনুযায়ী CPU ধীর করা। Lighthouse ফোনের মতো করতে পাতার CPU-র কাজ ৪ গুণ ধরে, কিন্তু
 * দ্রুত কম্পিউটারে একই কাজ কম সময় নেয়। তাই Lighthouse-এর নিজের মাপা গতি (BenchmarkIndex) দেখে গুণটা ঠিক
 * করা হয়: এই গতির মেশিনে ৪ গুণ, দ্বিগুণ দ্রুত মেশিনে ৮ গুণ। এতে আলাদা মেশিনে (এখানে, CI-তে, আপনার
 * কম্পিউটারে) কাছাকাছি ফল আসে।
 */
export const REFERENCE_BENCHMARK = 1500;

/** মেশিনের মাপা গতি → CPU কত গুণ ধীর ধরা হবে */
export const slowdownFor = (benchmark: number) =>
  Math.min(10, Math.max(2, (4 * benchmark) / REFERENCE_BENCHMARK));

export const METRICS = {
  fcp: "first-contentful-paint",
  lcp: "largest-contentful-paint",
  tbt: "total-blocking-time",
  cls: "cumulative-layout-shift",
  si: "speed-index",
} as const;
export type Metric = keyof typeof METRICS;

export interface Measure extends Record<Metric, number> {
  score: number;
  /** এই মাপে Lighthouse-এর মাপা মেশিনের গতি */
  benchmark: number;
  /** পাতার HTML, যেমন নেটওয়ার্কে এসেছে (চাপা, KB) */
  htmlKb: number;
  /** পাতার আমাদের ফাইল (লোডার, টুল আর chunk): কত KB আর কতগুলো */
  appKb: number;
  appFiles: number;
  /** আমাদের ফাইলগুলোর মোট CPU সময় (ms, ফোনের গতিতে) */
  appMs: number;
  /** প্রতিটা ফাইলে কত KB আর CPU-র কত ms (Lighthouse-এর হিসাবে, ফোনের গতিতে) */
  files: Record<string, { kb: number; ms: number }>;
}

interface NetworkItem {
  url: string;
  transferSize: number;
  resourceType?: string;
}
interface BootupItem {
  url: string;
  total: number;
}

/**
 * আমাদের ফাইল: নকল দোকানে /cdn/assets/..., আসল দোকানে Shopify-র CDN-এ অ্যাপ এক্সটেনশনের assets
 * (.../extensions/.../assets/...)। নাম: loader.js, tool-*.js, chunk-*.js।
 */
const OURS = /\/(?:cdn|extensions\/.+)\/assets\/(?:loader|tool-[\w-]+|chunk-[\w.-]+)\.js(?:\?|$)/;

/**
 * Lighthouse-এর ভেতরের DevTools কোড নতুন "insights" হিসাব করতে গিয়ে কখনো কখনো (Chrome চালুর পর প্রথম
 * মাপগুলোতে) একটা ভুল নিজেই ধরে console-এ লেখে। স্কোর বা মাপে এর প্রভাব নেই, তাই শুধু সেটুকু লগ থেকে বাদ।
 */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const error = console.error;
  console.error = (...args: unknown[]) => {
    const known = args.some(
      (a) => a instanceof Error && a.stack?.includes("LanternComputationData"),
    );
    if (!known) error(...args);
  };
  try {
    return await work();
  } finally {
    console.error = error;
  }
}

/**
 * একটা পাতা একবার মাপা: আগে পাতা লোড (gather), তারপর হিসাব (audit)। slowdown না দিলে এই মাপেই
 * মেশিনের গতি দেখে ঠিক করা হয়; দিলে সেটাই (পুরো পরীক্ষায় একটাই গুণ, যাতে গতির মাপের ওঠানামা ফলে না আসে)।
 */
export async function measure(port: number, url: string, slowdown?: number): Promise<Measure> {
  const dir = mkdtempSync(join(tmpdir(), "lighthouse-"));
  try {
    // Lighthouse-এর নিজের ছোট ভুলগুলো (যেমন DevTools-এর "insights" হিসাব) মাপ নষ্ট করে না; বড় ভুল
    // হলে runtimeError আসে, তখন ব্যর্থ
    const flags = { port, onlyCategories: ["performance"], logLevel: "silent" as const };
    await quietly(() => lighthouse(url, { ...flags, gatherMode: dir }));
    const saved = join(dir, "artifacts.json");
    const artifacts = JSON.parse(readFileSync(saved, "utf8")) as {
      BenchmarkIndex: number;
      settings: { throttling: { cpuSlowdownMultiplier: number } };
    };
    const benchmark = artifacts.BenchmarkIndex;
    const multiplier = slowdown ?? slowdownFor(benchmark);
    // simulated throttling-এ CPU-র গুণ শুধু হিসাবের সময় লাগে, পাতা লোডের সময় নয়; Lighthouse দুই ধাপের
    // সেটিংস মিলিয়ে দেখে, তাই জমা রাখা সেটিংসেও একই গুণ বসানো
    artifacts.settings.throttling.cpuSlowdownMultiplier = multiplier;
    writeFileSync(saved, JSON.stringify(artifacts));
    const result = await quietly(() =>
      lighthouse(
        url,
        { ...flags, auditMode: dir },
        {
          extends: "lighthouse:default",
          settings: { throttling: { cpuSlowdownMultiplier: multiplier } },
          // প্রতিটা ফাইলের CPU সময়, ছোটগুলোরও (ডিফল্টে শুধু ৫০ms-এর বেশি)
          audits: [{ path: "bootup-time", options: { thresholdInMs: 0 } }],
        },
      ),
    );
    const lhr = result!.lhr;
    if (lhr.runtimeError) throw new Error(`Lighthouse: ${lhr.runtimeError.message} (${url})`);
    const network = (lhr.audits["network-requests"]!.details as unknown as { items: NetworkItem[] })
      .items;
    const bootup = (lhr.audits["bootup-time"]!.details as unknown as { items: BootupItem[] }).items;
    const files: Measure["files"] = {};
    for (const item of network.filter((i) => OURS.test(i.url))) {
      const name = new URL(item.url).pathname.replace(/^.*\//, "");
      files[name] = { kb: item.transferSize / 1024, ms: 0 };
    }
    for (const item of bootup) {
      if (!OURS.test(item.url)) continue;
      const name = new URL(item.url).pathname.replace(/^.*\//, "");
      if (files[name]) files[name].ms = item.total;
    }
    const html = network.find((i) => i.resourceType === "Document");
    const measured = {
      score: (lhr.categories.performance!.score ?? 0) * 100,
      benchmark,
      htmlKb: (html?.transferSize ?? 0) / 1024,
      appKb: Object.values(files).reduce((sum, f) => sum + f.kb, 0),
      appFiles: Object.keys(files).length,
      appMs: Object.values(files).reduce((sum, f) => sum + f.ms, 0),
      files,
    } as Measure;
    for (const [key, id] of Object.entries(METRICS)) {
      measured[key as Metric] = lhr.audits[id]!.numericValue ?? 0;
    }
    return measured;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** সব স্টোরফ্রন্ট টুল, ডিফল্ট সেটিংসে; শুধু যেগুলো সেটিংস ছাড়া কিছুই দেখায় না তাদের ন্যূনতম সেটিংস */
export const ALL_TOOLS: StoreOptions = {
  offers: OFFERS,
  tools: STOREFRONT_TOOLS.map((id) => ({
    id,
    settings:
      id === "countdown-timer" || id === "chat-button" ? SCENARIOS[id]!.settings : undefined,
  })),
};

/** Playwright-এর Chromium, নকল দোকানের নিজে বানানো সার্টিফিকেট বিশ্বাস করে */
export function launchChrome() {
  return chromeLauncher.launch({
    chromePath: chromium.executablePath(),
    chromeFlags: [
      "--headless=new",
      "--no-sandbox",
      `--ignore-certificate-errors-spki-list=${tls().spki}`,
    ],
  });
}
