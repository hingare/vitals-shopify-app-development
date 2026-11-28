import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  axe,
  blocking,
  collectErrors,
  describeViolations,
  layoutShift,
  settle,
  watchLayout,
} from "./checks";
import { ONLY_ON } from "../src/pages";
import type { ToolModule } from "../src/types";
import { ALL_TOOLS, SCENARIOS, STOREFRONT_TOOLS } from "./scenarios";
import { PATHS, THEME, openStore, type PageKind, type Store } from "./store";

/**
 * প্রতিটা টুল একা চালু করে নকল দোকানের পাতায়: টুলটা দেখা যায় কিনা, axe-core-এ serious বা critical
 * সমস্যা আছে কিনা, পাতা কতটা সরে যায় (CLS) আর কোনো জাভাস্ক্রিপ্ট ভুল হয় কিনা। টুলের ফাইল আসে পাতা
 * আঁকার পরে, আসল দোকানের মতো (late), যাতে পরে আসা উইজেট লেখা নিচে ঠেললে ধরা পড়ে।
 */

/** একটা টুলের জন্য পাতা এর বেশি সরলে ব্যর্থ (প্ল্যানের "টুল সম্পূর্ণ" শর্ত) */
const MAX_CLS = 0.01;

/**
 * টুলের ফাইল পাতা আঁকার পরে এলে (late) পাতা একটুও সরা উচিত না, কারণ পাতার ভেতরের সব উইজেট early.ts আগেই
 * বসায় (মাপে ঠিক ০)। তাই ০.০১-এর নিচের ছোট সরাও ধরা হয়: নকল পাতার চেয়ে আসল দোকানে, বা কয়েকটা টুল মিলে, সেটা
 * বড় হয়। ধীরে আসা পাতার পরীক্ষায় (slow) MAX_CLS থাকে।
 */
const STILL = 0.001;

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
      late: true,
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
    expect(cls, `layout shift:\n${shifts.join("\n")}`).toBeLessThan(STILL);
    expect(errors).toEqual([]);
  });
}

/**
 * সব টুল একসাথে, ফাইল দেরিতে এলে: পাতা সরে না। একা প্রতিটা টুল ঠিক থাকলেও একসাথে একটা আরেকটাকে ঠেলতে
 * পারে, যেমন পরে আসা উইজেট আগে বসা উইজেটের ওপরে বসলে, বা ফর্মের ভেতরে বাটন যোগ হলে নিচের সবকিছু।
 */
/**
 * আগেভাগে বসা বাটন টুলের ফাইল আসার আগেই চাপলে চাপটা হারায় না (early.ts মনে রাখে): ফাইল এলে কাজটা হয়।
 * আসল দোকানে লোডার টুল আনে পাতা আঁকার পরে, ধীর ফোনে কয়েক সেকেন্ড পরে, আর বাটন তার আগেই দেখা যায়।
 */
const PRESSED: Record<string, (page: Page, store: Store) => Promise<unknown>> = {
  // নকল সার্ভার তালিকা সবসময় খালি ফেরত দেয়, তাই বাটনের অবস্থা নয়, সার্ভারে যাওয়া অনুরোধ দেখা হয়
  wishlist: (_page, store) => expect.poll(() => store.proxyCalls).toContain("POST wishlist"),
  "size-chart": (page) => expect(page.locator("dialog[open]")).toBeVisible(),
  "back-in-stock": (page) =>
    expect(page.locator('[data-app-widget="back-in-stock"] input[type=email]')).toBeFocused(),
  "accelerated-checkout": (page) => page.waitForURL("**/checkout"),
};
for (const [id, done] of Object.entries(PRESSED)) {
  test(`${id} remembers a press made before its file arrives`, async ({ page }) => {
    const scenario = SCENARIOS[id]!;
    const errors = collectErrors(page);
    let release = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const store = await openStore(page, {
      ...scenario.store,
      page: scenario.page,
      tools: [{ id, settings: scenario.settings }],
      hold,
    });
    await page.route("**/checkout", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Checkout</title>" }),
    );
    await page.locator(`[data-app-widget="${id}"] button, button[data-app-widget="${id}"]`).click();
    release();
    await done(page, store);
    expect(errors).toEqual([]);
  });
}

/**
 * আগেভাগে বসা Wishlist বাটন শুরু থেকেই আসল অবস্থায়: জমানো প্রোডাক্টে "যোগ করুন" দেখিয়ে চাপ নিলে পরে উল্টো কাজ
 * (তালিকা থেকে বাদ) হত।
 */
test("wishlist shows a saved product as saved before its file arrives", async ({ page }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await openStore(page, {
    page: "product",
    tools: [{ id: "wishlist" }],
    hold,
    storage: {
      app_wishlist: JSON.stringify({ o: 0, items: [{ productId: "1001", handle: "cotton-tee" }] }),
    },
  });
  const button = page.locator('[data-app-widget="wishlist"] button');
  await expect(button).toHaveAttribute("aria-pressed", "true");
  release();
});

for (const kind of ["product", "cart"] as PageKind[]) {
  test(`all tools together keep the ${kind} page still`, async ({ page }) => {
    await watchLayout(page);
    const errors = collectErrors(page);
    await openStore(page, {
      ...ALL_TOOLS,
      page: kind,
      cart: kind === "cart" ? [{ variant_id: 111, quantity: 1 }] : undefined,
      late: true,
    });
    await settle(page);
    const { cls, shifts } = await layoutShift(page);
    expect(cls, `layout shift:\n${shifts.join("\n")}`).toBeLessThan(STILL);
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

/** window আর document-এ বসানো event listener (ধরন অনুযায়ী গোনা), Chrome DevTools দিয়ে */
async function listeners(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  const found: string[] = [];
  for (const expression of ["window", "document"]) {
    const { result } = await cdp.send("Runtime.evaluate", { expression });
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
      objectId: result.objectId!,
    });
    found.push(...listeners.map((l) => `${expression} ${l.type}`));
  }
  await cdp.detach();
  return found.sort();
}

/**
 * লোডার যে টুলগুলো শুধু কয়েক ধরনের পাতায় আনে (src/pages.ts): বাকি পাতায় লোডার ফাইলটা আনে না, আর
 * জোর করে চালালেও টুলটা কিছুই করে না (পাতা বদলায় না, কোনো listener বসে না, কোনো অনুরোধ বা ভুল হয়
 * না)। তাই তালিকাটা কখনো কোনো টুলের কাজ বন্ধ করে না। টুলের নিজের পরীক্ষাটা (উপরে) তালিকার পাতাতেই চলে, লোডারের পথ ধরে।
 */
for (const [id, pages] of Object.entries(ONLY_ON)) {
  test(`${id} is only loaded where it does something`, async ({ page }) => {
    const scenario = SCENARIOS[id];
    expect(scenario, `${id} in src/pages.ts is not a storefront tool`).toBeDefined();
    if (!scenario) return;
    expect(pages).toContain(scenario.page);
    for (const kind of (Object.keys(PATHS) as PageKind[]).filter((k) => !pages.includes(k))) {
      const requests: string[] = [];
      const listen = (request: { url(): string }) => requests.push(request.url());
      page.on("request", listen);
      const errors = collectErrors(page);
      await openStore(page, {
        ...scenario.store,
        page: kind,
        tools: [{ id, settings: scenario.settings }],
      });
      await settle(page);
      expect(
        requests.filter((url) => url.endsWith(`/tool-${id}.js`)),
        kind,
      ).toEqual([]);

      // ফাইলটা আনা (ভাগের chunk-এর নিজের কাজ, যেমন analytics-এর listener, এর মধ্যেই), তারপর শুধু mount
      await page.evaluate(async (tool) => {
        const url = `${window.__APP_CONFIG__!.assetBase}tool-${tool}.js`;
        (window as unknown as { __tool: unknown }).__tool = await import(url);
      }, id);
      requests.length = 0;
      const before = await page.evaluate(() => document.documentElement.outerHTML);
      const listening = await listeners(page);
      await page.evaluate(async (tool) => {
        const config = window.__APP_CONFIG__!;
        const settings = config.tools.find((t) => t.id === tool)!.settings;
        const mod = (window as unknown as { __tool: ToolModule }).__tool;
        await mod.mount({ config, settings });
        await new Promise((resolve) => setTimeout(resolve, 500));
      }, id);
      expect(await page.evaluate(() => document.documentElement.outerHTML), kind).toBe(before);
      expect(await listeners(page), `${id} listens for events on the ${kind} page`).toEqual(
        listening,
      );
      expect(requests, `${id} sent requests on the ${kind} page`).toEqual([]);
      expect(errors, kind).toEqual([]);
      page.off("request", listen);
    }
  });
}
