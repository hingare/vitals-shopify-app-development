import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";

/** পরীক্ষার মাপকাঠি: accessibility (axe-core), লেআউট সরে যাওয়া (CLS) আর কোডের ভুল */

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

/** WCAG 2.2 AA আর axe-এর ভালো অভ্যাসের নিয়ম */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

export interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: string[];
}

/** পুরো পাতায় axe চালায়; শুধু দেখা যায় এমন অংশ পরীক্ষা হয় */
export async function axe(page: Page): Promise<Violation[]> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async (tags) => {
    interface AxeResult {
      violations: Array<{
        id: string;
        impact: string | null;
        help: string;
        nodes: Array<{ target: string[]; failureSummary?: string }>;
      }>;
    }
    const axe = (window as unknown as { axe: { run: (...args: unknown[]) => Promise<AxeResult> } })
      .axe;
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: tags },
      resultTypes: ["violations"],
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary ?? ""}`.trim()),
    }));
  }, AXE_TAGS);
}

/** যেগুলো থাকলে পরীক্ষা ব্যর্থ: serious আর critical */
export const blocking = (list: Violation[]) =>
  list.filter((v) => v.impact === "serious" || v.impact === "critical");

export const describeViolations = (list: Violation[]) =>
  list.map((v) => `${v.impact} ${v.id}: ${v.help}\n    ${v.nodes.join("\n    ")}`).join("\n");

/**
 * পাতা খোলার আগে ডাকতে হয়: লেআউট সরে যাওয়া গুনে রাখে (ক্রেতার ক্লিক বা টাইপের পরের সরণ বাদ,
 * যেমন Chrome-এর CLS-এ)। কোন উপাদান সরেছে তা-ও লিখে রাখে, যাতে ব্যর্থ হলে কারণ বোঝা যায়।
 */
export async function watchLayout(page: Page) {
  await page.addInitScript(() => {
    interface Shift extends PerformanceEntry {
      value: number;
      hadRecentInput: boolean;
      sources?: Array<{ node?: Node | null }>;
    }
    const w = window as unknown as { __cls: number; __shifts: string[] };
    w.__cls = 0;
    w.__shifts = [];
    const name = (node?: Node | null) => {
      if (!(node instanceof Element)) return node?.nodeName ?? "?";
      // node.id নয়: ফর্মের ভেতরে name="id" থাকলে সেটা ইনপুটটাকে ফেরত দেয়
      const id = node.getAttribute("id") ? `#${node.getAttribute("id")}` : "";
      const widget = node.closest("[data-app-widget]")?.getAttribute("data-app-widget");
      const cls =
        typeof node.className === "string" && node.className
          ? `.${node.className.split(" ")[0]}`
          : "";
      return `${node.tagName.toLowerCase()}${id}${cls}${widget ? ` (in ${widget})` : ""}`;
    };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Shift[]) {
          if (entry.hadRecentInput) continue;
          w.__cls += entry.value;
          w.__shifts.push(
            `${entry.value.toFixed(4)} @${Math.round(entry.startTime)}ms: ${(entry.sources ?? []).map((s) => name(s.node)).join(", ")}`,
          );
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // layout-shift সমর্থন নেই
    }
  });
}

export async function layoutShift(page: Page): Promise<{ cls: number; shifts: string[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { __cls: number; __shifts: string[] };
    return { cls: w.__cls ?? 0, shifts: w.__shifts ?? [] };
  });
}

/** পাতার জাভাস্ক্রিপ্ট ভুল আর উইজেট লোড না হওয়া ("[app] tool x failed") */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error")
      errors.push(`console.error: ${text} (${message.location().url})`);
    else if (message.type() === "warning" && text.startsWith("[app]"))
      errors.push(`console.warn: ${text}`);
  });
  return errors;
}

/** লোডার উইজেট চালায় ব্রাউজার ফাঁকা হলে; তারপর নেটওয়ার্ক থামা পর্যন্ত অপেক্ষা */
export async function settle(page: Page, extraMs = 600) {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(extraMs);
  await page.waitForLoadState("networkidle");
}
