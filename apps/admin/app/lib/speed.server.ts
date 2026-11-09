import db from "../db.server";
import type { GraphqlClient } from "./tools.server";

const PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export interface SpeedResult {
  score: number;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, { numericValue?: number }>;
  };
  error?: { message?: string };
}

export function parsePsi(json: PsiResponse): SpeedResult {
  const lh = json.lighthouseResult;
  const score = lh?.categories?.performance?.score;
  if (typeof score !== "number") {
    throw new Error(json.error?.message ?? "No performance score in response");
  }
  const audit = (id: string) => lh?.audits?.[id]?.numericValue;
  const lcp = audit("largest-contentful-paint");
  const cls = audit("cumulative-layout-shift");
  const tbt = audit("total-blocking-time");
  return {
    score: Math.round(score * 100),
    lcpMs: lcp === undefined ? null : Math.round(lcp),
    cls: cls === undefined ? null : Math.round(cls * 1000) / 1000,
    tbtMs: tbt === undefined ? null : Math.round(tbt),
  };
}

/** Google PageSpeed Insights দিয়ে স্টোরের হোমপেজের মোবাইল স্কোর মাপে। */
export async function measure(url: string): Promise<SpeedResult> {
  const params = new URLSearchParams({ url, strategy: "mobile", category: "performance" });
  if (process.env.PAGESPEED_API_KEY) params.set("key", process.env.PAGESPEED_API_KEY);
  const res = await fetch(`${PSI_URL}?${params}`, { signal: AbortSignal.timeout(90_000) });
  const json = (await res.json()) as PsiResponse;
  if (!res.ok) throw new Error(json.error?.message ?? `PageSpeed returned ${res.status}`);
  return parsePsi(json);
}

export async function primaryDomainUrl(admin: GraphqlClient): Promise<string> {
  const res = await admin.graphql(`#graphql
    query PrimaryDomain { shop { primaryDomain { url } } }`);
  const json = (await res.json()) as { data?: { shop?: { primaryDomain?: { url: string } } } };
  const url = json.data?.shop?.primaryDomain?.url;
  if (!url) throw new Error("Could not read the store's domain");
  return url;
}

/**
 * মাপের ফল ইতিহাসে রাখে। কোনো টুল চালুর আগের প্রথম মাপটা "baseline",
 * যাতে পরে দেখানো যায় অ্যাপ চালুর আগে আর পরে স্কোর কত।
 */
export async function saveSnapshot(shopId: string, url: string, result: SpeedResult) {
  const [enabledTools, hasBaseline] = await Promise.all([
    db.toolSetting.count({ where: { shopId, enabled: true } }),
    db.speedSnapshot.count({ where: { shopId, kind: "baseline" } }),
  ]);
  const kind = hasBaseline === 0 && enabledTools === 0 ? "baseline" : "check";
  return db.speedSnapshot.create({
    data: { shopId, url, kind, enabledTools, ...result },
  });
}

export async function getSpeedSummary(shopId: string) {
  const [baseline, history] = await Promise.all([
    db.speedSnapshot.findFirst({
      where: { shopId, kind: "baseline" },
      orderBy: { createdAt: "asc" },
    }),
    db.speedSnapshot.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return { baseline, latest: history[0] ?? null, history };
}
