import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  METRICS,
  launchChrome,
  measure,
  median,
  slowdownFor,
  type Measure,
  type Metric,
} from "./lighthouse";
import { ALL_TOOLS } from "./scenarios";
import { serveStore, type Served } from "./serve";
import { PATHS, type PageKind } from "./store";

/**
 * দোকানের গতি: মোবাইল Lighthouse-এর স্কোর আমাদের টুল চালু করলে কতটা কমে, Shopify যেভাবে মাপে
 * (https://shopify.dev/docs/apps/build/performance/storefront): হোম ১৭%, প্রোডাক্ট ৪০%, কালেকশন ৪৩%
 * ওজনে গড়, টুল ছাড়া আর টুলসহ। Built for Shopify-র সীমা ১০ পয়েন্ট; প্ল্যানের লক্ষ্য ২ পয়েন্ট।
 *
 * নকল দোকানটা একটা সাধারণ Dawn দোকানের মতো ভারী (e2e/weight.ts), আর সব স্টোরফ্রন্ট টুল একসাথে চালু,
 * ডিফল্ট সেটিংসে (মার্চেন্ট প্রথমবার চালু করলে যা পায়), সাথে অফার: সবচেয়ে খারাপ অবস্থা, একটা টুল একা
 * এর চেয়ে অনেক কম খরচ করে। স্কোরের পাশাপাশি আমাদের নিজের খরচেরও সীমা আছে (BUDGET)।
 *
 * আসল দোকানে মাপা (ডেভ স্টোর, বেটা দোকান): SPEED_BEFORE আর SPEED_AFTER-এ তিনটা ঠিকানা কমা দিয়ে
 * (হোম,প্রোডাক্ট,কালেকশন), যেমন অ্যাপ বন্ধ আর চালু থাকা দুটো থিমের preview লিংক। docs/storefront-tests.md
 *
 * চালানো: `pnpm --filter @app/widgets build` তারপর `pnpm --filter @app/widgets speed`।
 * SPEED_RUNS (ডিফল্ট ৫), SPEED_MAX_DROP (ডিফল্ট ৫)।
 */

const PAGES: Array<{ kind: PageKind; weight: number }> = [
  { kind: "index", weight: 0.17 },
  { kind: "product", weight: 0.4 },
  { kind: "collection", weight: 0.43 },
];
const RUNS = Number(process.env.SPEED_RUNS ?? 5);

/**
 * প্ল্যানের লক্ষ্য ২ পয়েন্ট, কিন্তু CI ব্যর্থ হয় ৫-এর বেশি কমলে (Built for Shopify-র সীমার অর্ধেক)।
 * কারণ একই কোডে এক জোড়া মাপ থেকে আরেক জোড়ায় পাতার স্কোরের পার্থক্য অনেক ওঠানামা করে (GitHub-এর এক
 * রানে −১৩ থেকে +১৩; মূলত TBT: ফোনের গতিতে কয়েক গুণ বড় করা কাজ ৫০ms-এর সীমার এপাশ-ওপাশ হয়, অ্যাপ
 * ছাড়াও একই পাতার TBT ১৮০ থেকে ৬৬০ms), তাই ৫ জোড়ার মধ্যমাও রান থেকে রানে ১-২ পয়েন্ট নড়ে (একই কোডে
 * GitHub-এ একবার ২.১, আরেকবার ৩.৯; লম্বা কাজ ঠিক করার পরে ০.৭ আর ২.০)। ২-এ আটকালে কোনো বদল ছাড়াই
 * CI মাঝে মাঝে লাল হত। খরচ হঠাৎ বাড়লে ধরে খরচের সীমা (BUDGET), যা অনেক কম নড়ে; স্কোর লক্ষ্যের ওপরে
 * গেলে রিপোর্টে লেখা থাকে।
 */
const TARGET = 2;
const MAX_DROP = Number(process.env.SPEED_MAX_DROP ?? 5);

/**
 * প্রতি জোড়ায় পাতার আকার আলাদা: থিমের ডেটা এতটা KB বেশি (চাপা অবস্থায়, e2e/weight.ts)। Lighthouse
 * নেটওয়ার্কের সময় round trip ধরে ধরে হিসাব করে, তাই একই ১০KB যোগ কোনো আকারের পাতায় ০ms, কোনোটায়
 * ~১৫০ms বাড়ায় (একটা ফাইল এক round trip পরে আসে)। এক আকারে মাপলে সেই ভাগ্যই ফল ঠিক করত (আগে
 * প্রোডাক্ট পাতায় LCP প্রায় সবসময় ~২০০ms বাড়ত); আসল দোকানগুলোর আকার নানা রকম, তাই এখানেও।
 */
const EXTRA_KB = [0, 5, 10, 15, 20];

/**
 * আমাদের নিজের খরচের সীমা, প্রতি পাতায়, নকল দোকানে সব টুল চালু থাকলে (মধ্যমা)। শুধু স্কোর দেখলে
 * চলে না: স্কোর ওঠানামা করে আর অন্য কারণেও বদলায় (যেমন পাতা আঁকা একটু পেছালে Lighthouse TBT কম গোনে),
 * তাই আমাদের খরচ বাড়লেও স্কোরে সবসময় ধরা পড়ে না। এগুলো সরাসরি আমাদের খরচ দেখে:
 * - html: app embed পাতার HTML-এ কত KB যোগ করে (চাপা অবস্থায়)। পাতা আঁকার আগে এটুকু বেশি আসতে হয়।
 * - kb আর ms: আমাদের JS ফাইল (লোডার, টুল, chunk) কত KB আসে আর ফোনের গতিতে CPU-র কত ms নেয়।
 * মাপা মানের চেয়ে খানিকটা বেশি রাখা, যাতে মেশিনের ওঠানামায় ব্যর্থ না হয় কিন্তু খরচ হঠাৎ বাড়লে ধরা
 * পড়ে। ইচ্ছা করে খরচ বাড়ালে (নতুন টুল) সীমা বাড়ান আর কারণ PR-এ লিখুন; কিছু হালকা করলে নামিয়ে দিন।
 */
const BUDGET = {
  // ~১৩KB মাপা: পাতার ভেতরের সব উইজেট পাতা আঁকার আগে বসানোর স্ক্রিপ্ট (app-early, ~৯KB) এর বড় ভাগ
  html: 15,
  index: { kb: 70, ms: 600 },
  product: { kb: 85, ms: 1000 },
  collection: { kb: 70, ms: 600 },
} as const;

interface Variant {
  name: "before" | "after";
  urls: Record<PageKind, string>;
}

test("our tools barely change the Lighthouse score", async () => {
  const servers: Served[] = [];
  const real = process.env.SPEED_BEFORE && process.env.SPEED_AFTER;
  let variants: Variant[];
  if (real) {
    const urls = (list: string) => {
      const [index, product, collection] = list.split(",").map((u) => u.trim());
      if (!index || !product || !collection) throw new Error("need home,product,collection");
      return { index, product, collection, cart: "" };
    };
    variants = [
      { name: "before", urls: urls(process.env.SPEED_BEFORE!) },
      { name: "after", urls: urls(process.env.SPEED_AFTER!) },
    ];
  } else {
    const before = await serveStore({ tools: [], weight: true });
    const after = await serveStore({ ...ALL_TOOLS, weight: true });
    servers.push(before, after);
    const urls = (served: Served) =>
      Object.fromEntries(
        Object.entries(PATHS).map(([kind, path]) => [kind, served.origin + path]),
      ) as Record<PageKind, string>;
    variants = [
      { name: "before", urls: urls(before) },
      { name: "after", urls: urls(after) },
    ];
  }

  const chrome = await launchChrome();
  const results: Record<string, Record<Variant["name"], Measure[]>> = {};
  let slowdown = 0;
  try {
    // প্রথমবার Chrome আর সার্ভার গরম হয়; এই মাপ বাদ, শুধু মেশিনের গতি দেখা হয়। পুরো পরীক্ষায় একটাই
    // গুণ, কারণ প্রতিটা মাপের গতির হিসাব নিজেই ±১৫% ওঠানামা করে
    const benchmarks: number[] = [];
    for (const { kind } of PAGES) {
      for (const variant of variants) {
        benchmarks.push((await measure(chrome.port, variant.urls[kind])).benchmark);
      }
    }
    slowdown = slowdownFor(median(benchmarks));
    for (let run = 0; run < RUNS; run++) {
      // আসল দোকানের ঠিকানায় কিছু যোগ করা যায় না (preview লিংকে নিজেরই ?preview_theme_id থাকে)
      const size = real ? "" : `?extra=${EXTRA_KB[run % EXTRA_KB.length]}`;
      for (const { kind } of PAGES) {
        // পালা করে আগে-পরে, যাতে মেশিনের ধীর হওয়া এক দিকেই না পড়ে
        const order = run % 2 === 0 ? variants : [...variants].reverse();
        for (const variant of order) {
          const m = await measure(chrome.port, variant.urls[kind] + size, slowdown);
          ((results[kind] ??= { before: [], after: [] })[variant.name] ??= []).push(m);
          console.log(
            `${kind.padEnd(10)} ${variant.name.padEnd(6)} score ${m.score.toFixed(0).padStart(3)}` +
              `  FCP ${m.fcp.toFixed(0)}  LCP ${m.lcp.toFixed(0)}  TBT ${m.tbt.toFixed(0)}` +
              `  CLS ${m.cls.toFixed(3)}  SI ${m.si.toFixed(0)}  ours ${m.appMs.toFixed(0)}ms`,
          );
        }
      }
    }
  } finally {
    await chrome.kill();
    for (const served of servers) await served.close();
  }

  // প্রতিটা পাতার মধ্যমা (median)। কতটা কমল: পাশাপাশি মাপা প্রতি জোড়ার (আগে − পরে) মধ্যমা, Shopify-র
  // ওজনে যোগ; জোড়ায় মাপলে মেশিনের ধীরে ধীরে বদলানো গতি দুই দিকেই সমান পড়ে
  const rows = PAGES.map(({ kind, weight }) => {
    const r = results[kind]!;
    const mid = (variant: Variant["name"], key: keyof Measure) =>
      median(r[variant].map((m) => m[key] as number));
    const paired = (key: "score" | "htmlKb") =>
      median(r.before.map((m, i) => r.after[i]![key] - m[key]));
    return {
      kind,
      weight,
      before: mid("before", "score"),
      after: mid("after", "score"),
      drop: -paired("score"),
      metrics: Object.fromEntries(
        (Object.keys(METRICS) as Metric[]).map((key) => [
          key,
          { before: mid("before", key), after: mid("after", key) },
        ]),
      ) as Record<Metric, { before: number; after: number }>,
      html: paired("htmlKb"),
      appKb: mid("after", "appKb"),
      appFiles: mid("after", "appFiles"),
      appMs: mid("after", "appMs"),
    };
  });
  const weighted = (key: "before" | "after" | "drop") =>
    rows.reduce((sum, row) => sum + row.weight * row[key], 0);
  const drop = weighted("drop");

  // সীমার বাইরে যা গেছে (শুধু নকল দোকানে; আসল দোকানে আগে-পরের থিম আলাদা হতে পারে)
  const over = real
    ? []
    : rows.flatMap((row) => {
        const budget = BUDGET[row.kind as keyof typeof BUDGET] as { kb: number; ms: number };
        return [
          row.html > BUDGET.html &&
            `${row.kind}: HTML-এ ${row.html.toFixed(1)} KB যোগ হয় (সীমা ${BUDGET.html})`,
          row.appKb > budget.kb &&
            `${row.kind}: আমাদের JS ${row.appKb.toFixed(1)} KB (সীমা ${budget.kb})`,
          row.appMs > budget.ms &&
            `${row.kind}: আমাদের CPU ${row.appMs.toFixed(0)} ms (সীমা ${budget.ms})`,
        ].filter((problem): problem is string => !!problem);
      });

  // ফাইল ধরে খরচ (টুলসহ মাপগুলোর মধ্যমা), সব পাতা মিলিয়ে ওজনে
  const files = new Map<string, { kb: number; ms: number }>();
  for (const { kind, weight } of PAGES) {
    const after = results[kind]!.after;
    const names = new Set(after.flatMap((m) => Object.keys(m.files)));
    for (const name of names) {
      const kb = median(after.map((m) => m.files[name]?.kb ?? 0));
      const ms = median(after.map((m) => m.files[name]?.ms ?? 0));
      const total = files.get(name) ?? { kb: 0, ms: 0 };
      files.set(name, { kb: total.kb + weight * kb, ms: total.ms + weight * ms });
    }
  }
  const costly = [...files.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 10);

  const lines = [
    `# দোকানের গতি (মোবাইল Lighthouse, ${real ? "আসল দোকানে" : "নকল Dawn দোকানে সব টুল চালু করে"})`,
    "",
    `প্রতিটা পাতা আগে (অ্যাপ ছাড়া) আর পরে ${RUNS} বার করে, মধ্যমা (median)` +
      (real ? "" : `, প্রতি জোড়ায় পাতার আকার আলাদা (থিমের ডেটা +${EXTRA_KB.join("/")} KB)`) +
      `। CPU ${slowdown.toFixed(1)} গুণ ধীর ধরা (এই মেশিনের গতি অনুযায়ী, ফোনের মতো করতে)।`,
    "",
    "| পাতা | ওজন | স্কোর আগে → পরে | কমেছে | FCP (ms) | LCP (ms) | TBT (ms) | CLS |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.kind} | ${Math.round(row.weight * 100)}% | ${row.before.toFixed(0)} → ${row.after.toFixed(0)} | ` +
        `${row.drop.toFixed(1)} | ` +
        `${row.metrics.fcp.before.toFixed(0)} → ${row.metrics.fcp.after.toFixed(0)} | ` +
        `${row.metrics.lcp.before.toFixed(0)} → ${row.metrics.lcp.after.toFixed(0)} | ` +
        `${row.metrics.tbt.before.toFixed(0)} → ${row.metrics.tbt.after.toFixed(0)} | ` +
        `${row.metrics.cls.before.toFixed(3)} → ${row.metrics.cls.after.toFixed(3)} |`,
    ),
    "",
    `Shopify-র ওজনে (হোম ১৭%, প্রোডাক্ট ৪০%, কালেকশন ৪৩%) স্কোর কমেছে **${drop.toFixed(1)} পয়েন্ট** ` +
      `(লক্ষ্য ${TARGET}, CI ব্যর্থ হয় ${MAX_DROP}-এর বেশি হলে, Built for Shopify-র সীমা ১০; ঋণাত্মক মানে বেড়েছে)।`,
    ...(drop > TARGET
      ? [
          "",
          `**লক্ষ্যের (${TARGET}) ওপরে।** একবার আবার চালিয়ে দেখুন (ফল কয়েক পয়েন্ট ওঠানামা করে); বারবার হলে ` +
            "নিচের খরচ দেখুন, আর কোনো ফাইল হালকা করার আগে Chrome-এর Performance profiler-এ মিলিয়ে নিন।",
        ]
      : []),
    "",
    "আমাদের খরচ, প্রতি পাতায়:",
    "",
    "| পাতা | HTML-এ যোগ (KB) | আমাদের JS ফাইল | JS (KB) | CPU (ms) |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.kind} | ${row.html.toFixed(1)} | ${row.appFiles.toFixed(0)}টা | ` +
        `${row.appKb.toFixed(1)} | ${row.appMs.toFixed(0)} |`,
    ),
    "",
    ...(real
      ? []
      : [
          `সীমা: HTML-এ ${BUDGET.html} KB; JS আর CPU হোম ${BUDGET.index.kb} KB/${BUDGET.index.ms} ms, ` +
            `প্রোডাক্ট ${BUDGET.product.kb} KB/${BUDGET.product.ms} ms, ` +
            `কালেকশন ${BUDGET.collection.kb} KB/${BUDGET.collection.ms} ms।`,
          "",
          "সবচেয়ে বেশি CPU নেওয়া ফাইল (তিন পাতার ওজনে গড়), Lighthouse-এর হিসাবে। Lighthouse একটা পুরো কাজ " +
            "(ব্রাউজারের নিজের style আর layout-সহ) সেই কাজে চলা প্রথম স্ক্রিপ্টের নামে লেখে, যেমন কোনো " +
            "MutationObserver-এর ডাক, তাই ফাইল ধরে ভাগটা আনুমানিক:",
          "",
          "| ফাইল | KB | CPU (ms) |",
          "| --- | --- | --- |",
          ...costly.map(([name, f]) => `| ${name} | ${f.kb.toFixed(1)} | ${f.ms.toFixed(0)} |`),
          "",
        ]),
    ...(over.length > 0
      ? ["**সীমার বাইরে:**", "", ...over.map((problem) => `- ${problem}`), ""]
      : []),
  ];
  const report = lines.join("\n");
  console.log(`\n${report}\n`);
  const out = join(process.cwd(), "test-results", "speed");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "report.md"), `${report}\n`);
  writeFileSync(
    join(out, "results.json"),
    JSON.stringify({ slowdown, rows, drop, results }, null, 2),
  );

  expect(drop, report).toBeLessThanOrEqual(MAX_DROP);
  expect(over, report).toEqual([]);
});
