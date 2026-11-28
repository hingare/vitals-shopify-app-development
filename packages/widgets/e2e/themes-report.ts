import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Violation } from "./checks";
import type { PageKind } from "./store";

/**
 * আসল থিমের পরীক্ষার (e2e/themes.ts) ফল এক জায়গায়: প্রতিটা থিম আর ডিভাইসের JSON আর স্ক্রিনশট থেকে
 * test-results/themes/report.md। Playwright সব পরীক্ষা শেষে এটা চালায় (globalTeardown), কিছু ব্যর্থ হলেও।
 */

/** প্রতিটা থিম আর ডিভাইসের JSON আর স্ক্রিনশট (shots/) */
export const REPORT_DIR = fileURLToPath(new URL("../test-results/themes/report/", import.meta.url));
const REPORT = join(REPORT_DIR, "..", "report.md");

export interface PageResult {
  kind: PageKind;
  url: string;
  /** লেআউট সরে যাওয়া (CLS), পাতা থিতু হওয়া পর্যন্ত; shifts: আমাদেরসহ পাতায় কী সরেছে */
  cls: { theme: number; ours: number; shifts: string[] };
  /** ours: আমাদের ফাইল থেকে আসা ভুল; added: শুধু আমাদেরসহ পাতায় দেখা অন্য ভুল */
  errors: { ours: string[]; added: string[] };
  /** আমাদের উইজেটের ভেতরে axe-এর সব ফল (serious আর critical হলে সমস্যা) */
  axe: Violation[];
  /** যে উইজেটগুলো দেখা গেল */
  widgets: string[];
  /** এই পাতায় যেগুলো খোঁজা হয়েছিল */
  checked: string[];
  /** উইজেটের বাক্স কোথায় বসল */
  placement: Record<string, string>;
  /** থিমের Add to cart বাটন চাপলে কার্টে যোগ হলো কিনা (null = বাটন নেই) */
  atc: { theme: boolean | null; ours: boolean | null } | null;
  /** REPORT_DIR-এর সাপেক্ষে */
  shots: { theme: string; ours: string };
  /** ঠিক করতে হবে */
  problems: string[];
  /** চোখে দেখে নেওয়ার মতো */
  warnings: string[];
}

export interface ThemeResult {
  /** পরীক্ষার নাম (THEME_IDS-এ দেওয়া) */
  target: string;
  /** থিমের নিজের নাম আর সংস্করণ (Shopify.theme) */
  theme: string;
  viewport: string;
  store: string;
  pages: PageResult[];
  /** পরীক্ষা মাঝপথে থামলে কেন */
  error?: string;
}

const PAGE_NAMES: Record<PageKind, string> = {
  index: "হোম",
  collection: "কালেকশন",
  product: "প্রোডাক্ট",
  cart: "কার্ট",
};
const KINDS: PageKind[] = ["index", "collection", "product", "cart"];

const label = (r: ThemeResult) =>
  r.theme && r.theme !== r.target ? `${r.target} (${r.theme})` : r.target;
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n+/g, " ");
const shot = (path: string) => `report/${path}`;

function results(): ThemeResult[] {
  if (!existsSync(REPORT_DIR)) return [];
  return readdirSync(REPORT_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(REPORT_DIR, file), "utf8")) as ThemeResult)
    .sort((a, b) => a.target.localeCompare(b.target) || a.viewport.localeCompare(b.viewport));
}

function summaryRow(r: ThemeResult): string {
  const problems = r.pages.reduce((sum, p) => sum + p.problems.length, 0);
  const warnings = r.pages.reduce((sum, p) => sum + p.warnings.length, 0);
  const verdict = r.error
    ? "❌ থেমে গেছে"
    : problems > 0
      ? `❌ ${problems}টা সমস্যা`
      : warnings > 0
        ? `⚠️ ${warnings}টা দেখার মতো`
        : "✅ ঠিক আছে";
  const atc = r.pages.find((p) => p.kind === "product")?.atc;
  const atcText = !atc
    ? "—"
    : atc.ours === null
      ? "বাটন পাওয়া যায়নি"
      : atc.ours
        ? "চলে"
        : atc.theme
          ? "বন্ধ হয়ে গেছে"
          : "থিম একাও যোগ করেনি";
  const worst = r.pages.reduce<PageResult | null>(
    (top, p) => (!top || p.cls.ours - p.cls.theme > top.cls.ours - top.cls.theme ? p : top),
    null,
  );
  const cls = worst
    ? `${(worst.cls.ours - worst.cls.theme).toFixed(3)} (${PAGE_NAMES[worst.kind]})`
    : "—";
  const widgets = r.pages.find((p) => p.kind === "product")?.widgets.length ?? 0;
  return `| ${cell(label(r))} | ${r.viewport} | ${verdict} | ${atcText} | ${cls} | ${widgets} |`;
}

function list(rows: ThemeResult[], key: "problems" | "warnings"): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const items = r.pages.flatMap((p) => p[key].map((text) => `- ${PAGE_NAMES[p.kind]}: ${text}`));
    if (key === "problems" && r.error) items.unshift(`- পরীক্ষা থেমে গেছে: ${r.error}`);
    if (items.length === 0) continue;
    out.push(`### ${label(r)} · ${r.viewport}`, "", ...items, "");
  }
  return out;
}

/** প্রতিটা পাতায় কোন উইজেট কোন থিমে দেখা গেল */
function widgetTables(rows: ThemeResult[]): string[] {
  const out: string[] = [];
  const columns = rows.map((r) => `${r.target} ${r.viewport === "desktop" ? "🖥" : "📱"}`);
  for (const kind of KINDS) {
    const seen = rows.map((r) => new Set(r.pages.find((p) => p.kind === kind)?.widgets ?? []));
    const ids = [...new Set(seen.flatMap((s) => [...s]))].sort();
    const checked = new Set(
      rows.flatMap((r) => r.pages.find((p) => p.kind === kind)?.checked ?? []),
    );
    const missing = [...checked].filter((id) => !ids.includes(id)).sort();
    if (ids.length === 0 && missing.length === 0) continue;
    out.push(
      `### ${PAGE_NAMES[kind]}`,
      "",
      `| উইজেট | ${columns.map(cell).join(" | ")} |`,
      `|---|${columns.map(() => "---").join("|")}|`,
      ...ids.map((id) => `| ${id} | ${seen.map((s) => (s.has(id) ? "✓" : "✗")).join(" | ")} |`),
      "",
    );
    if (missing.length > 0) out.push(`কোনো থিমেই দেখা যায়নি: ${missing.join(", ")}`, "");
  }
  return out;
}

function clsTable(rows: ThemeResult[]): string[] {
  return [
    `| থিম | ডিভাইস | ${KINDS.map((k) => PAGE_NAMES[k]).join(" | ")} |`,
    `|---|---|${KINDS.map(() => "---").join("|")}|`,
    ...rows.map((r) => {
      const cells = KINDS.map((kind) => {
        const p = r.pages.find((x) => x.kind === kind);
        return p ? `${p.cls.theme.toFixed(3)} → ${p.cls.ours.toFixed(3)}` : "—";
      });
      return `| ${cell(label(r))} | ${r.viewport} | ${cells.join(" | ")} |`;
    }),
  ];
}

function shots(rows: ThemeResult[]): string[] {
  return rows.flatMap((r) => [
    `- ${label(r)} · ${r.viewport}: ${r.pages
      .map(
        (p) =>
          `${PAGE_NAMES[p.kind]} [থিম একা](${shot(p.shots.theme)}) / [আমাদেরসহ](${shot(p.shots.ours)})`,
      )
      .join(" · ")}`,
  ]);
}

export function writeReport(): string | null {
  const rows = results();
  if (rows.length === 0) return null;
  const stores = [...new Set(rows.map((r) => r.store))].join(", ");
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    "# আসল থিমে সব টুল একসাথে",
    "",
    `দোকান: ${stores} · ${date} · সব স্টোরফ্রন্ট টুল চালু (ডিফল্ট সেটিংস), পরীক্ষার অফার দোকানের প্রোডাক্ট দিয়ে।`,
    "প্রতিটা পাতা দুইবার খোলা হয়েছে: থিম একা, আর আমাদের এখনকার বিল্ডসহ।",
    "",
    "| থিম | ডিভাইস | ফল | Add to cart (আমাদেরসহ) | পাতা সরা, সবচেয়ে বেশি বাড়া | প্রোডাক্ট পাতায় উইজেট |",
    "|---|---|---|---|---|---|",
    ...rows.map(summaryRow),
    "",
  ];
  const problems = list(rows, "problems");
  if (problems.length > 0) lines.push("## সমস্যা (ঠিক করতে হবে)", "", ...problems);
  const warnings = list(rows, "warnings");
  if (warnings.length > 0) lines.push("## চোখে দেখে নেওয়ার মতো", "", ...warnings);
  lines.push(
    "## পাতা সরা (CLS: থিম একা → আমাদেরসহ)",
    "",
    ...clsTable(rows),
    "",
    "## কোন উইজেট দেখা গেল",
    "",
    "কোনো থিমেই দেখা না যাওয়া উইজেট সাধারণত দোকানের তথ্য বা সেটিংসের কারণে (যেমন স্টক শেষ এমন ভ্যারিয়েন্ট নেই,",
    "কার্টে কিছু নেই, বা পপআপ দেরিতে আসে)। কিছু থিমে ✓ আর কিছুতে ✗ হলে সেই থিমে জায়গা মেলেনি কিনা স্ক্রিনশটে দেখুন।",
    "",
    ...widgetTables(rows),
    "## স্ক্রিনশট",
    "",
    ...shots(rows),
    "",
  );
  writeFileSync(REPORT, lines.join("\n"));
  return REPORT;
}

/** Playwright-এর globalTeardown */
export default function globalTeardown() {
  const path = writeReport();
  if (path) console.log(`\nআসল থিমের পরীক্ষার ফল: ${path}`);
}
