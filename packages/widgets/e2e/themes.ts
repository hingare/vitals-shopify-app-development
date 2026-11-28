import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { runsOn } from "../src/pages";
import {
  axe,
  blocking,
  describeViolations,
  layoutShift,
  watchLayout,
  type Violation,
} from "./checks";
import { ALL_TOOLS, OFFERS, SCENARIOS } from "./scenarios";
import { serveStore, type Served } from "./serve";
import {
  ASSETS,
  EMBED_HANDLE,
  embedFor,
  likeNewVisitor,
  liquidFromAjax,
  proxyAnswer,
  type AjaxProductData,
  type LiquidProduct,
  type PageFacts,
  type PageKind,
} from "./store";
import { REPORT_DIR, type PageResult, type ThemeResult } from "./themes-report";

/**
 * আসল থিমে সব টুল একসাথে (স্টেজ ৮-এর রিগ্রেশন পরীক্ষা)।
 *
 * ডেভেলপমেন্ট স্টোরের প্রতিটা থিমের হোম, কালেকশন, প্রোডাক্ট আর কার্ট পাতা দুইবার খোলা হয়: একবার থিম
 * একা, একবার আমাদের এখনকার বিল্ডসহ (সব টুল চালু, ডিফল্ট সেটিংস, আর দোকানের প্রোডাক্ট দিয়ে পরীক্ষার
 * অফার)। embed দোকানে বসাতে হয় না: পরীক্ষা নিজেই পাতার HTML-এ embed-এর আসল Liquid বসায় (store.ts-এর
 * embedFor), আমাদের ফাইল আর App Proxy-র উত্তরও নিজে দেয়। তাই দোকানে কিছু বদলায় না, অ্যাপ ইনস্টল বা
 * deploy লাগে না; দোকানে আগে থেকে আমাদের embed চালু থাকলে সেটা দুই বারেই সরানো হয়।
 *
 * প্রতিটা পাতায় দেখা হয়: আমাদের কোডের জাভাস্ক্রিপ্ট ভুল, পাতা কতটা সরে (CLS, থিম একা আর আমাদেরসহ),
 * আমাদের উইজেটের accessibility (axe), কোন উইজেট দেখা গেল আর কোথায় বসল, প্রোডাক্ট পাতায় থিমের
 * Add to cart তখনও চলে কিনা; সাথে দুই বারের স্ক্রিনশট। ফল test-results/themes/report.md-তে।
 *
 * THEME_STORE না দিলে দুটো নকল দোকানে নিজের পরীক্ষা চলে (CI-তে): পাসওয়ার্ড দেওয়া, দোকানে বসানো embed
 * সরানো আর আমাদেরটা বসানো ঠিক কাজ করে কিনা। চালানোর নিয়ম: docs/storefront-tests.md।
 */

const SELF_TEST = !process.env.THEME_STORE;
/** আমাদের বিল্ড করা ফাইল দোকানের এই পথে দেওয়া হয় (Shopify-র কোনো পথের সাথে মেলে না) */
const ASSET_PREFIX = "/__app-test/assets/";
/**
 * আমাদেরসহ পাতায় অন্তত এতক্ষণ থাকা, যাতে দেরিতে আসা উইজেটও (পপআপ, Spin Wheel, Recent Sales ৮ সেকেন্ড,
 * পুশ ১০ সেকেন্ড পরে) দেখা আর পরীক্ষা হয়। নিজের পরীক্ষায় লাগে না।
 */
const LATE_MS = Number(process.env.THEME_LATE_MS ?? (SELF_TEST ? 0 : 11_000));
/** এর বেশি পাতা সরা (আমাদেরসহ − থিম একা) সমস্যা; CLS 0.1-এর বেশি হলে Google "খারাপ" ধরে */
const CLS_PROBLEM = 0.1;
/** এর বেশি হলে চোখে দেখার মতো (আসল থিমে বিজ্ঞাপন, ছবি বা স্লাইডারে প্রতিবার একটু আলাদা হয়) */
const CLS_WARNING = 0.02;

/** আমাদের উইজেট যেসব উপাদানের ভেতরে থাকে (axe শুধু এগুলোর ভেতরে) */
const OURS = [
  "[data-app-widget]",
  "[id^='app-']",
  "[class^='app-']",
  "[class*=' app-']",
  "[data-app-tabs]",
];
/** দেখা যায় এমন উইজেট আর দেখা গেলে যে উপাদান থাকে (e2e/scenarios.ts) */
const VISIBLE = Object.entries(SCENARIOS).flatMap(([id, s]) =>
  s.expect ? [[id, s.expect] as [string, string]] : [],
);
/** উইজেটের বাক্স (src/product.ts) */
const BOXES = ["app-after-form", "app-near-checkout", "app-after-section"];
/** থিমের Add to cart ফর্ম আর চেকআউট বাটন, src/product.ts যেভাবে খোঁজে */
const PRODUCT_FORM = 'main form[action*="/cart/add"]:not([id*="installment"])';
const CHECKOUT = 'main [name="checkout"]';

const PATHS: Record<PageKind, (handle: string) => string> = {
  index: () => "/",
  collection: () => "/collections/all",
  product: (handle) => `/products/${handle}`,
  cart: () => "/cart",
};
const KINDS: PageKind[] = ["index", "collection", "product", "cart"];

const PAGE_NAMES: Record<PageKind, string> = {
  index: "হোম",
  collection: "কালেকশন",
  product: "প্রোডাক্ট",
  cart: "কার্ট",
};

interface Target {
  /** পরীক্ষার নাম: THEME_IDS-এ দেওয়া নাম, বা থিমের id */
  name: string;
  /** অপ্রকাশিত থিম (?preview_theme_id=); না থাকলে দোকানের চালু থিম */
  themeId?: string;
}

/** THEME_IDS="Dawn=123,Sense=456" বা "123 456"; "live" = দোকানের চালু থিম; কিছু না দিলে শুধু চালু থিম */
function targets(): Target[] {
  if (SELF_TEST) return [{ name: "fake-bare" }, { name: "fake-installed" }];
  const list = (process.env.THEME_IDS ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((item): Target => {
      const [name, id] = item.includes("=") ? item.split("=", 2) : [item, item];
      if (id === "live") return { name: name! };
      if (!/^\d+$/.test(id ?? "")) throw new Error(`THEME_IDS: "${item}" is not name=<theme id>`);
      return { name: name!, themeId: id };
    });
  return list.length > 0 ? list : [{ name: "live" }];
}

interface Store {
  origin: string;
  password?: string;
}

const FAKE_PASSWORD = "test";
const fakes = new Map<string, Promise<Served>>();

/** নিজের পরীক্ষার নকল দোকান: fake-bare-এ আমাদের অ্যাপ নেই, fake-installed-এ আমাদের embed আগে থেকে চালু */
function fakeStore(name: string): Promise<Served> {
  let served = fakes.get(name);
  if (!served) {
    served = serveStore({
      ...(name === "fake-installed" ? ALL_TOOLS : { tools: [] }),
      password: FAKE_PASSWORD,
    });
    fakes.set(name, served);
  }
  return served;
}

test.afterAll(async () => {
  for (const served of fakes.values()) await (await served).close();
  fakes.clear();
});

async function storeFor(target: Target): Promise<Store> {
  if (SELF_TEST) return { origin: (await fakeStore(target.name)).origin, password: FAKE_PASSWORD };
  const host = process.env
    .THEME_STORE!.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return {
    origin: `https://${host.includes(".") ? host : `${host}.myshopify.com`}`,
    password: process.env.THEME_PASSWORD,
  };
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  if (!response.ok()) throw new Error(`${url}: HTTP ${response.status()}`);
  return (await response.json()) as T;
}

const isRedirect = (status: number) => status >= 300 && status < 400;

/**
 * দোকানের পাসওয়ার্ড দেওয়া: Shopify CLI-র মতো সরাসরি /password-এ POST; কুকি ব্রাউজারেই থাকে।
 * পাসওয়ার্ড ছাড়া খোলা দোকান সম্ভবত চালু (লাইভ) দোকান, তাই সেখানে থামে, THEME_ALLOW_PUBLIC=1 না দিলে।
 */
async function unlock(page: Page, store: Store) {
  const first = await page.request.get(`${store.origin}/`, { maxRedirects: 0 });
  const location = first.headers().location ?? "";
  const locked = isRedirect(first.status()) && location.includes("/password");
  if (isRedirect(first.status()) && !locked) {
    const to = new URL(location, store.origin);
    if (to.origin !== store.origin) {
      throw new Error(`${store.origin} redirects to ${to.origin}: set THEME_STORE=${to.host}`);
    }
  }
  if (!locked) {
    if (process.env.THEME_ALLOW_PUBLIC === "1") return;
    throw new Error(
      `${store.origin} has no storefront password, so it may be a live store. ` +
        "Run this only on a development store (or set THEME_ALLOW_PUBLIC=1 if you are sure).",
    );
  }
  if (!store.password) throw new Error("The store asks for a password: set THEME_PASSWORD");
  const response = await page.request.post(`${store.origin}/password`, {
    form: { form_type: "storefront_password", utf8: "✓", password: store.password },
    maxRedirects: 0,
  });
  if (!isRedirect(response.status()) || (response.headers().location ?? "").includes("/password")) {
    throw new Error("The storefront password was not accepted (THEME_PASSWORD)");
  }
}

interface Picked {
  id: number;
  handle: string;
  title: string;
  /** প্রথম কেনা যায় এমন ভ্যারিয়েন্ট */
  variantId: number;
  image: string | null;
}

interface ListedProduct {
  id: number;
  handle: string;
  title: string;
  images?: Array<{ src: string }>;
  variants: Array<{ id: number; available: boolean }>;
}

interface ShopMeta {
  name?: string;
  currency?: string;
  money_format?: string;
}

/** দোকানের প্রোডাক্ট: প্রথম কেনা যায় এমনটা প্রোডাক্ট পাতায়, বাকিগুলো অফারে */
async function discover(page: Page, origin: string) {
  const { products } = await getJson<{ products: ListedProduct[] }>(
    page,
    `${origin}/products.json?limit=30`,
  );
  const buyable = products
    .filter((p) => p.variants.some((v) => v.available))
    .map((p): Picked => ({
      id: p.id,
      handle: p.handle,
      title: p.title,
      variantId: p.variants.find((v) => v.available)!.id,
      image: p.images?.[0]?.src ?? null,
    }));
  const [main, ...others] = buyable;
  if (!main) throw new Error(`${origin} has no product that can be bought`);
  const ajax = await getJson<AjaxProductData>(page, `${origin}/products/${main.handle}.js`);
  const meta = await getJson<ShopMeta>(page, `${origin}/meta.json`).catch((): ShopMeta => ({}));
  return { main, others, product: liquidFromAjax(ajax), meta };
}

/** পরীক্ষার অফার (e2e/scenarios.ts-এর OFFERS), দোকানের আসল প্রোডাক্ট দিয়ে */
function offersFor(main: Picked, others: Picked[]) {
  const [second = main, third = second, fourth = third] = others;
  return {
    volume: OFFERS.volume,
    bundles: [
      {
        ...OFFERS.bundles[0]!,
        title: `${main.title} + ${second.title}`,
        items: [
          { productId: String(main.id), handle: main.handle, qty: 1 },
          { productId: String(second.id), handle: second.handle, qty: 1 },
        ],
      },
    ],
    gifts: [
      {
        ...OFFERS.gifts[0]!,
        variantId: String(fourth.variantId),
        handle: fourth.handle,
        title: fourth.title,
      },
    ],
    bogo: [
      { ...OFFERS.bogo[0]!, buyProductIds: [String(main.id)], getProductIds: [String(main.id)] },
    ],
    upsells: [
      {
        ...OFFERS.upsells[0]!,
        products: [
          { id: String(third.id), handle: third.handle },
          { id: String(fourth.id), handle: fourth.handle },
        ],
      },
    ],
  };
}

/** দোকানে বসানো আমাদের embed: Shopify প্রতিটা app block এই মন্তব্যের মাঝে রাখে */
const INSTALLED = new RegExp(
  `<!-- BEGIN app block: shopify://apps/[^/]+/blocks/${EMBED_HANDLE}/[^>]*-->[\\s\\S]*?<!-- END app block -->`,
  "g",
);

/** app embed (target: head) Shopify যেখানে বসায়: </head>-এর ঠিক আগে */
function inject(html: string, embed: string): string {
  const beforeBody = html.search(/<\/head>\s*<body/i);
  const at = beforeBody >= 0 ? beforeBody : html.search(/<\/head>/i);
  return at >= 0 ? html.slice(0, at) + embed + html.slice(at) : embed + html;
}

type Mode = "theme" | "ours";

interface State {
  mode: Mode;
  embed: string;
  /** পাতা আবার পাসওয়ার্ড চাইল */
  lockedOut: boolean;
}

/**
 * দোকানের অনুরোধগুলো: পাতার HTML থেকে দোকানে বসানো আমাদের embed সরানো (আর আমাদেরসহ পাতায় এখনকারটা
 * বসানো), আমাদের ফাইল আর App Proxy-র উত্তর দেওয়া। বাকি সব (থিমের ফাইল, Ajax API) আসল দোকান থেকে।
 */
async function intercept(page: Page, origin: string, state: State, proxy: Record<string, unknown>) {
  await page.route(
    (url) => url.origin === origin,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.startsWith(ASSET_PREFIX)) {
        const file = url.pathname.slice(ASSET_PREFIX.length);
        let body: Buffer;
        try {
          body = readFileSync(ASSETS + file);
        } catch {
          return route.fulfill({ status: 404, body: "" });
        }
        return route.fulfill({
          status: 200,
          contentType: file.endsWith(".css") ? "text/css" : "application/javascript",
          body,
        });
      }
      const proxied = /\/apps\/app-tools\/(.*)$/.exec(url.pathname);
      if (proxied) {
        const sub = proxied[1]! + url.search;
        if (sub.startsWith("sw.js")) {
          return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(proxyAnswer(sub, request.method(), { proxy })),
        });
      }
      if (
        request.method() === "GET" &&
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame()
      ) {
        const response = await route.fetch();
        if (!(response.headers()["content-type"] ?? "").includes("text/html")) {
          return route.fulfill({ response });
        }
        if (new URL(response.url()).pathname.endsWith("/password")) state.lockedOut = true;
        let html = (await response.text()).replace(INSTALLED, "");
        if (state.mode === "ours") html = inject(html, state.embed);
        const headers = { ...response.headers() };
        // body এখন খোলা লেখা; কুকি route.fetch আগেই ব্রাউজারে রেখেছে
        for (const name of [
          "content-encoding",
          "content-length",
          "transfer-encoding",
          "set-cookie",
        ]) {
          delete headers[name];
        }
        return route.fulfill({ status: response.status(), headers, body: html });
      }
      return route.continue();
    },
  );
}

interface Seen {
  text: string;
  /** আমাদের ফাইল থেকে বা "[app]" দিয়ে শুরু */
  ours: boolean;
}

function watchErrors(page: Page): Seen[] {
  const seen: Seen[] = [];
  page.on("pageerror", (error) =>
    seen.push({
      text: `pageerror: ${error.message}`,
      ours: (error.stack ?? "").includes(ASSET_PREFIX),
    }),
  );
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error") {
      seen.push({
        text: `console.error: ${text}`,
        ours: text.startsWith("[app]") || message.location().url.includes(ASSET_PREFIX),
      });
    } else if (message.type() === "warning" && text.startsWith("[app]")) {
      seen.push({ text: `console.warn: ${text}`, ours: true });
    }
  });
  return seen;
}

/** পাতা থিতু হওয়া: load, নেটওয়ার্ক থামা, তারপর আমাদের লোডার (ব্রাউজার ফাঁকা হলে চলে) */
async function quiet(page: Page) {
  await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
}

/** নিচ পর্যন্ত ধীরে স্ক্রল (Sticky Add to cart, দেরিতে লোড হওয়া অংশ), শেষে নিচেই থাকে */
async function scrollDown(page: Page) {
  await page.evaluate(async () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 150));
    for (
      let step = 0;
      step < 40 && scrollY + innerHeight < document.documentElement.scrollHeight - 2;
      step++
    ) {
      scrollBy(0, Math.round(innerHeight * 0.8));
      await pause();
    }
  });
  await page.waitForTimeout(800);
}

/** এই পাতায় যে উইজেটগুলো খোঁজা হয় (যেগুলোর এই পাতায় চলার কথা) */
const lookFor = (kind: PageKind) => VISIBLE.filter(([id]) => runsOn(id, kind));

/** এখন দেখা যাচ্ছে এমন উইজেট (আমাদের উপাদানের ভেতরে, মাপ আছে, লুকানো নয়) */
function visibleWidgets(page: Page, kind: PageKind): Promise<string[]> {
  return page.evaluate(
    ([entries, ours]) =>
      entries
        .filter(([, selector]) => {
          const el = document.querySelector(selector);
          if (!el?.closest(ours)) return false;
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return (
            box.width > 0 &&
            box.height > 0 &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
        })
        .map(([id]) => id),
    [lookFor(kind), OURS.join(",")] as const,
  );
}

interface Visit {
  errors: Seen[];
  cls: { cls: number; shifts: string[] };
  /** __APP_CONFIG__ আছে (আমাদের embed চলেছে) */
  config: boolean;
  /** [data-app-widget] কয়টা */
  hosts: number;
  widgets: string[];
  placement: Record<string, string>;
  /** থিমের Add to cart ফর্ম আর চেকআউট বাটন পাওয়া গেল কিনা */
  anchors: { form: boolean; checkout: boolean };
  axe: Violation[];
  atc: boolean | null;
  /** বাটনের উপরে অন্য কিছু ছিল */
  covered: string | null;
  theme: {
    id?: number | string;
    name?: string;
    schema_name?: string;
    schema_version?: string;
  } | null;
  shopify: { locale: string; country: string | null; currency: string | null; root: string };
}

/** থিমের Add to cart বাটন চাপা; কার্টে কিছু যোগ হলো কিনা (null = চাপার মতো বাটন নেই) */
async function addToCart(
  page: Page,
  origin: string,
): Promise<{ added: boolean | null; covered: string | null }> {
  const button = page.locator(`${PRODUCT_FORM} [type="submit"]`).first();
  const ready =
    (await button.isVisible().catch(() => false)) && (await button.isEnabled().catch(() => false));
  if (!ready) return { added: null, covered: null };
  const count = async () =>
    (await getJson<{ item_count: number }>(page, `${origin}/cart.js`)).item_count;
  const before = await count();
  // খোলা পপআপ বন্ধ (আমাদের সব dialog Escape-এ বন্ধ হয়)
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  let covered: string | null = null;
  try {
    await button.click({ timeout: 5_000 });
  } catch (error) {
    // বাটনের উপরে কিছু আছে: সেটা জানিয়ে রাখা, তারপর থিমের কোড চলে কিনা দেখতে সরাসরি ক্লিক
    covered =
      String(error)
        .split("\n")
        .find((line) => line.includes("intercepts")) ?? "click failed";
    await button.dispatchEvent("click");
  }
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
  return { added: (await count()) > before, covered: covered?.trim() ?? null };
}

async function visit(
  page: Page,
  state: State,
  seen: Seen[],
  options: { mode: Mode; url: string; kind: PageKind; shot: string; origin: string },
): Promise<Visit> {
  const { mode, url, kind, shot, origin } = options;
  state.mode = mode;
  state.lockedOut = false;
  const from = seen.length;
  const started = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (state.lockedOut) throw new Error("The store asked for the password again");
  await quiet(page);
  const cls = await layoutShift(page);
  const widgets = new Set(await visibleWidgets(page, kind));
  await scrollDown(page);
  for (const id of await visibleWidgets(page, kind)) widgets.add(id);
  await page.evaluate(() => scrollTo(0, 0));
  if (mode === "ours") await page.waitForTimeout(Math.max(0, started + LATE_MS - Date.now()));
  await page.waitForTimeout(500);
  for (const id of await visibleWidgets(page, kind)) widgets.add(id);

  const info = await page.evaluate(
    ([boxes, form, checkout]) => {
      const describe = (el: Element | null) => {
        if (!el) return "—";
        const id = el.getAttribute("id");
        const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
        return `${el.tagName.toLowerCase()}${id ? `#${id}` : ""}${cls ? `.${cls}` : ""}`;
      };
      const placement: Record<string, string> = {};
      for (const id of boxes) {
        const box = document.getElementById(id);
        if (!box) continue;
        const height = Math.round(box.getBoundingClientRect().height);
        placement[id] =
          `after ${describe(box.previousElementSibling)} in ${describe(box.parentElement)}, ${height}px`;
      }
      const shopify = (
        window as unknown as {
          Shopify?: {
            locale?: string;
            country?: string;
            currency?: { active?: string };
            routes?: { root?: string };
            theme?: Visit["theme"];
          };
        }
      ).Shopify;
      return {
        config: "__APP_CONFIG__" in window,
        hosts: document.querySelectorAll("[data-app-widget]").length,
        placement,
        anchors: {
          form: !!document.querySelector(form),
          checkout: !!document.querySelector(checkout),
        },
        theme: shopify?.theme ?? null,
        shopify: {
          locale: shopify?.locale ?? (document.documentElement.lang || "en"),
          country: shopify?.country ?? null,
          currency: shopify?.currency?.active ?? null,
          root: shopify?.routes?.root ?? "/",
        },
      };
    },
    [BOXES, PRODUCT_FORM, CHECKOUT] as const,
  );
  const violations = mode === "ours" ? await axe(page, OURS) : [];
  await page.screenshot({
    path: join(REPORT_DIR, shot),
    fullPage: true,
    type: "jpeg",
    quality: 50,
  });
  const atc = kind === "product" ? await addToCart(page, origin) : { added: null, covered: null };
  return {
    ...info,
    errors: seen.slice(from),
    cls,
    widgets: [...widgets].sort(),
    axe: violations,
    atc: atc.added,
    covered: atc.covered,
  };
}

const unique = (list: string[]) => [...new Set(list)];

/** আমাদেরসহ পাতার ভুল: আমাদের ফাইল থেকে আসা, আর বাকিগুলোর মধ্যে যা থিম একা পাতায় ছিল না */
function newErrors(theme: Visit, ours: Visit) {
  const before = new Set(theme.errors.map((e) => e.text));
  return {
    ours: unique(ours.errors.filter((e) => e.ours).map((e) => e.text)),
    added: unique(ours.errors.filter((e) => !e.ours && !before.has(e.text)).map((e) => e.text)),
  };
}

/**
 * দুই বারের তুলনা: কী ঠিক করতে হবে আর কী চোখে দেখার মতো। নিজের পরীক্ষায় (নকল দোকান, সব আগে থেকে জানা)
 * পরীক্ষার নিজের কলকবজার সতর্কতাও ব্যর্থতা; পাতা সরা সেখানে শুধু রিপোর্টে, কারণ সেটা মাপে e2e/tools.e2e.ts।
 */
function compare(kind: PageKind, theme: Visit, ours: Visit) {
  const problems: string[] = [];
  const warnings: string[] = [];
  const strictly = (text: string) => (SELF_TEST ? problems : warnings).push(text);
  if (theme.config || theme.hosts > 0) {
    problems.push("থিম একা পাতায়ও আমাদের কোড চলেছে (দোকানে বসানো embed সরানো যায়নি)");
  }
  if (!ours.config) problems.push("আমাদের embed পাতায় চলেনি");
  if (kind === "product" && ours.hosts === 0) problems.push("প্রোডাক্ট পাতায় একটাও উইজেট বসেনি");

  const errors = newErrors(theme, ours);
  problems.push(...errors.ours.map((text) => `আমাদের কোডের ভুল: ${text}`));
  for (const text of errors.added) strictly(`শুধু আমাদেরসহ পাতায় দেখা ভুল: ${text}`);

  const serious = blocking(ours.axe);
  if (serious.length > 0) problems.push(`accessibility:\n${describeViolations(serious)}`);

  const delta = ours.cls.cls - theme.cls.cls;
  const shift = `পাতা সরা বেড়েছে ${delta.toFixed(3)} (${theme.cls.cls.toFixed(3)} → ${ours.cls.cls.toFixed(3)}): ${ours.cls.shifts.join("; ")}`;
  if (delta > CLS_PROBLEM) problems.push(shift);
  else if (delta > CLS_WARNING) warnings.push(shift);
  const inWidget = ours.cls.shifts.filter((s) => s.includes("(in "));
  if (inWidget.length > 0)
    warnings.push(`দেখা দেওয়ার পরে আমাদের উইজেট সরেছে: ${inWidget.join("; ")}`);

  if (kind === "product" && !ours.anchors.form) {
    strictly("থিমের Add to cart ফর্ম পাওয়া যায়নি, তাই ফর্মের নিচের উইজেটগুলো পাতার শেষে");
  }
  if (kind === "cart" && !ours.anchors.checkout) {
    strictly("চেকআউট বাটন পাওয়া যায়নি, তাই কার্টের উইজেটগুলো পাতার শেষে");
  }
  if (kind === "product") {
    if (theme.atc === true && ours.atc === false) {
      problems.push("আমাদের কোডসহ থিমের Add to cart আর কাজ করে না");
    }
    if (ours.covered) strictly(`Add to cart বাটনের উপরে অন্য কিছু ছিল: ${ours.covered}`);
    if (SELF_TEST && (theme.atc !== true || ours.atc !== true)) {
      problems.push(`নকল দোকানে Add to cart চলেনি (থিম একা: ${theme.atc}, আমাদেরসহ: ${ours.atc})`);
    }
  }
  return { problems, warnings };
}

/** আমাদেরসহ পাতার embed যে তথ্য দিয়ে বানানো: থিম একা পাতা আর দোকানের Ajax API থেকে */
async function facts(
  page: Page,
  origin: string,
  kind: PageKind,
  alone: Visit,
  product: LiquidProduct,
  meta: ShopMeta,
): Promise<PageFacts> {
  const cart = await getJson<{ currency: string; total_price: number; item_count: number }>(
    page,
    `${origin}/cart.js`,
  );
  const shopCurrency = meta.currency ?? cart.currency;
  const country = alone.shopify.country ?? "US";
  return {
    kind,
    origin,
    assetBase: ASSET_PREFIX,
    locale: alone.shopify.locale,
    country,
    countries: [country],
    currency: cart.currency ?? alone.shopify.currency ?? shopCurrency,
    shopCurrency,
    moneyFormat:
      meta.money_format ?? (shopCurrency === "USD" ? "${{amount}}" : `{{amount}} ${shopCurrency}`),
    shopName: meta.name ?? new URL(origin).hostname,
    root: alone.shopify.root,
    cart: { total: cart.total_price, count: cart.item_count },
    product: kind === "product" ? product : null,
    collection:
      kind === "collection"
        ? { title: "All", url: "/collections/all", default_sort_by: "manual" }
        : null,
  };
}

const slug = (text: string) => text.replace(/[^\w.-]+/g, "-");

for (const target of targets()) {
  test(target.name, async ({ page }, testInfo) => {
    test.setTimeout(10 * 60_000);
    const viewport = testInfo.project.name;
    const store = await storeFor(target);
    const name = `${slug(target.name)}-${viewport}`;
    mkdirSync(join(REPORT_DIR, "shots"), { recursive: true });
    const result: ThemeResult = {
      target: target.name,
      theme: "",
      viewport,
      store: SELF_TEST ? "নকল দোকান (নিজের পরীক্ষা)" : new URL(store.origin).host,
      pages: [],
    };

    try {
      await unlock(page, store);
      const { main, others, product, meta } = await discover(page, store.origin);
      const second = others[0] ?? main;
      const state: State = { mode: "theme", embed: "", lockedOut: false };
      // Recent Sales-এ দোকানের আসল প্রোডাক্ট, যাতে নকল ছবির 404 ভুল হিসেবে না আসে
      const proxy = {
        "recent-sales": {
          sales: [
            {
              title: second.title,
              url: `/products/${second.handle}`,
              image: second.image,
              soldAt: new Date(Date.now() - 600_000).toISOString(),
            },
          ],
        },
      };
      const offers = offersFor(main, others);
      await likeNewVisitor(page);
      await watchLayout(page);
      // Shopify-র preview বার (অপ্রকাশিত থিম দেখার সময়), দুই বারেই লুকানো
      await page.addInitScript(() => {
        document.addEventListener("DOMContentLoaded", () => {
          const style = document.createElement("style");
          style.textContent = "#preview-bar-iframe,#PBarNextFrameWrapper{display:none!important}";
          document.head.appendChild(style);
        });
      });
      const seen = watchErrors(page);
      await intercept(page, store.origin, state, proxy);
      const fillCart = async () => {
        await page.request.post(`${store.origin}/cart/clear.js`);
        await page.request.post(`${store.origin}/cart/add.js`, {
          data: { items: [{ id: main.variantId, quantity: 1 }] },
        });
      };

      for (const kind of KINDS) {
        const query = target.themeId ? `?preview_theme_id=${target.themeId}&pb=0` : "";
        const url = `${store.origin}${PATHS[kind](main.handle)}${query}`;
        const shot = (mode: Mode) => `shots/${name}-${kind}-${mode}.jpg`;
        if (kind === "cart") await fillCart();
        const alone = await visit(page, state, seen, {
          mode: "theme",
          url,
          kind,
          shot: shot("theme"),
          origin: store.origin,
        });
        if (target.themeId && String(alone.theme?.id) !== target.themeId) {
          throw new Error(
            `preview_theme_id=${target.themeId} opened theme ${alone.theme?.id ?? "?"} instead`,
          );
        }
        if (!result.theme && alone.theme) {
          const t = alone.theme;
          result.theme = [
            t.name,
            t.schema_name && t.schema_name !== t.name ? t.schema_name : "",
            t.schema_version,
          ]
            .filter(Boolean)
            .join(" ");
        }
        if (kind === "cart") await fillCart();
        state.embed = embedFor(
          { tools: ALL_TOOLS.tools, offers },
          await facts(page, store.origin, kind, alone, product, meta),
        );
        const ours = await visit(page, state, seen, {
          mode: "ours",
          url,
          kind,
          shot: shot("ours"),
          origin: store.origin,
        });
        const { problems, warnings } = compare(kind, alone, ours);
        const pageResult: PageResult = {
          kind,
          url,
          cls: { theme: alone.cls.cls, ours: ours.cls.cls, shifts: ours.cls.shifts },
          errors: newErrors(alone, ours),
          axe: ours.axe,
          widgets: ours.widgets,
          // যে উইজেটের এই পাতায় দেখা দেওয়ার কথা (scenarios.ts-এ এই পাতার); বাকিগুলো দেখা গেলেও তালিকায় আসে
          checked: lookFor(kind)
            .filter(([id]) => SCENARIOS[id]!.page === kind)
            .map(([id]) => id),
          placement: ours.placement,
          atc: kind === "product" ? { theme: alone.atc, ours: ours.atc } : null,
          shots: { theme: shot("theme"), ours: shot("ours") },
          problems,
          warnings,
        };
        result.pages.push(pageResult);
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      writeFileSync(join(REPORT_DIR, `${name}.json`), JSON.stringify(result, null, 2));
    }

    const failures = result.pages.flatMap((p) =>
      p.problems.map((text) => `${PAGE_NAMES[p.kind]}: ${text}`),
    );
    expect(failures, failures.join("\n")).toEqual([]);
  });
}
