import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  axe,
  blocking,
  collectErrors,
  describeViolations,
  layoutShift,
  settle,
  watchLayout,
} from "./checks";
import { SCENARIOS, STOREFRONT_TOOLS } from "./scenarios";
import { THEME, openStore, type PageKind } from "./store";

/**
 * প্রতিটা টুল একা চালু করে নকল দোকানের পাতায়: টুলটা দেখা যায় কিনা, axe-core-এ serious বা critical
 * সমস্যা আছে কিনা, পাতা কতটা সরে যায় (CLS) আর কোনো জাভাস্ক্রিপ্ট ভুল হয় কিনা।
 */

/** একটা টুলের জন্য পাতা এর বেশি সরলে ব্যর্থ (প্ল্যানের "টুল সম্পূর্ণ" শর্ত) */
const MAX_CLS = 0.01;

/**
 * পাতার ভেতরে বসা টুলগুলো (উপরের বার, Add to cart-এর নিচের বাক্স, কার্টের নোটিস, বিবরণের ট্যাব...)
 * পাতা আঁকার আগেই বসে: app embed-এর app-early স্নিপেট (src/early.ts)। তালিকাটা embed-এর Liquid থেকেই
 * নেওয়া, যাতে দুই জায়গায় আলাদা না হয়।
 */
const EMBED_LIQUID = readFileSync(`${THEME}blocks/app-tools-embed.liquid`, "utf8");
const EARLY_TOOLS = [
  ...(
    /when ((?:'[\w-]+'(?:, )?)+) -%\}\s*\{%- assign early = true/.exec(EMBED_LIQUID)?.[1] ?? ""
  ).matchAll(/'([\w-]+)'/g),
].map((m) => m[1]!);

test("every storefront tool has a scenario", () => {
  expect(Object.keys(SCENARIOS).sort()).toEqual([...STOREFRONT_TOOLS].sort());
});

for (const kind of ["product", "cart", "collection", "index"] as PageKind[]) {
  test(`the ${kind} page is clean before any tool runs`, async ({ page }) => {
    await watchLayout(page);
    const errors = collectErrors(page);
    await openStore(page, { tools: [], page: kind });
    await settle(page);
    // নকল পাতাটা নিজেই নিখুঁত, তাই টুল চালু করার পর যা পাওয়া যায় তা টুলেরই
    const violations = await axe(page);
    expect(violations, describeViolations(violations)).toEqual([]);
    expect((await layoutShift(page)).cls).toBe(0);
    expect(errors).toEqual([]);
  });
}

for (const id of STOREFRONT_TOOLS) {
  test(id, async ({ page }) => {
    const scenario = SCENARIOS[id];
    expect(scenario, `add a scenario for ${id} in e2e/scenarios.ts`).toBeDefined();
    if (!scenario) return;
    await watchLayout(page);
    const errors = collectErrors(page);
    await openStore(page, {
      ...scenario.store,
      page: scenario.page,
      tools: [{ id, settings: scenario.settings }],
    });
    if (scenario.expect) await expect(page.locator(scenario.expect).first()).toBeAttached();
    await settle(page);

    const all = await axe(page);
    // moderate আর minor ব্যর্থ করে না, তবে রিপোর্টে থাকে
    for (const v of all.filter((x) => !blocking([x]).length)) {
      test.info().annotations.push({
        type: `axe ${v.impact}`,
        description: `${v.id}: ${v.nodes.join(" | ")}`,
      });
    }
    const violations = blocking(all);
    expect(violations, describeViolations(violations)).toEqual([]);
    const { cls, shifts } = await layoutShift(page);
    expect(cls, `layout shift:\n${shifts.join("\n")}`).toBeLessThan(MAX_CLS);
    expect(errors).toEqual([]);
  });
}

test("the early tools list is read from the app embed", () => {
  expect(EARLY_TOOLS.length).toBeGreaterThan(5);
  for (const id of EARLY_TOOLS) expect(STOREFRONT_TOOLS).toContain(id);
});

/**
 * ধীর নেটওয়ার্কে ব্রাউজার HTML পড়া শেষ হওয়ার আগেই পাতা আঁকে। তখনও এই টুলগুলোর জন্য কিছু সরে না:
 * উইজেট বসে থিমের জিনিসটা পুরো পড়া হলে (যেমন Add to cart ফর্ম), তার আগে নয়।
 */
for (const id of EARLY_TOOLS) {
  test(`${id} while the page is still arriving`, async ({ page }) => {
    const scenario = SCENARIOS[id]!;
    await watchLayout(page);
    const errors = collectErrors(page);
    await openStore(page, {
      ...scenario.store,
      page: scenario.page,
      tools: [{ id, settings: scenario.settings }],
      slow: true,
    });
    if (scenario.expect) await expect(page.locator(scenario.expect).first()).toBeAttached();
    await settle(page);
    const { cls, shifts } = await layoutShift(page);
    expect(cls, `layout shift:\n${shifts.join("\n")}`).toBeLessThan(MAX_CLS);
    expect(errors).toEqual([]);
  });
}
