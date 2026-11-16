import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { AI_BOTS, productSchemas, scoreOf, visibilityReport } =
  await import("./ai-visibility.server");

type Variables = Record<string, unknown>;
const BASE = "https://shop.example";
const PRODUCT_URL = `${BASE}/products/linen-shirt`;
const EDITOR = "https://admin.shopify.com/store/x/themes/current/editor?context=apps";
const LONG = "Light and airy linen shirt. ".repeat(12);

/** নকল Admin API: operation-এর নাম দেখে উত্তর দেয় */
function fakeAdmin(handlers: Record<string, (variables: Variables) => unknown>) {
  return {
    graphql: vi.fn(async (query: string, options?: { variables?: Variables }) => {
      const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
      const handler = handlers[name];
      if (!handler) throw new Error(`Unexpected operation ${name}`);
      return new Response(JSON.stringify({ data: handler(options?.variables ?? {}) }));
    }),
  };
}

const product = (
  extra: {
    description?: string;
    seo?: { title: string | null; description: string | null };
    alts?: Array<string | null>;
    onlineStoreUrl?: string | null;
  } = {},
) => ({
  onlineStoreUrl: extra.onlineStoreUrl === undefined ? PRODUCT_URL : extra.onlineStoreUrl,
  description: extra.description ?? LONG,
  seo: extra.seo ?? { title: "Linen Shirt | Example", description: "A light linen shirt." },
  media: {
    nodes: (extra.alts ?? ["Front view"]).map((alt) => ({ mediaContentType: "IMAGE", alt })),
  },
});

const store = (products: unknown[], description: string | null = "Linen clothing for summer.") =>
  fakeAdmin({
    AiVisibility: () => ({
      shop: { description, primaryDomain: { url: BASE } },
      productsCount: { count: products.length },
      products: { nodes: products },
    }),
    MainThemeSettings: () => ({
      themes: {
        nodes: [
          {
            files: {
              nodes: [
                {
                  body: {
                    content: JSON.stringify({
                      current: {
                        blocks: {
                          a: { type: "shopify://apps/x/blocks/app-tools-embed/1", disabled: false },
                        },
                      },
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    }),
  });

const ld = (data: unknown, ours = false) =>
  `<script type="application/ld+json"${ours ? " data-app-schema" : ""}>${JSON.stringify(data)}</script>`;
const OUR_PAGE = `<html>${ld({ "@type": "Product", name: "Linen Shirt" }, true)}</html>`;

/** নকল স্টোরফ্রন্ট: ঠিকানা দেখে পাতা দেয় */
function storefront(pages: Record<string, { status?: number; body?: string; url?: string }>) {
  return vi.fn(async (url: string) => {
    const page = pages[url.replace(BASE, "")];
    if (!page) throw new Error(`offline: ${url}`);
    return {
      url: page.url ?? url,
      status: page.status ?? 200,
      contentType: "",
      body: page.body ?? "",
    };
  });
}

const OPEN = {
  "/robots.txt": { body: "User-agent: *\nDisallow: /cart\n" },
  "/llms.txt": { body: "# Example" },
  "/agents.md": { body: "# Agents" },
  "/products/linen-shirt": { body: OUR_PAGE },
};

let shop: { id: string; plan: string | null };
const enable = (toolId: string, settings: Record<string, unknown> = {}) =>
  db.toolSetting.seed({ shopId: shop.id, toolId, enabled: true, settings });
const state = (report: Awaited<ReturnType<typeof visibilityReport>>) =>
  Object.fromEntries(report.checks.map((item) => [item.id, item.state]));

beforeEach(() => {
  resetFakeDb();
  const row = db.shop.seed({ domain: "x.myshopify.com" });
  shop = { id: row.id as string, plan: "professional" };
});

describe("AI visibility score", () => {
  it("gives a store with everything in place full marks", async () => {
    enable("ai-seo-schema");
    enable("product-reviews");
    enable("ai-product-faq");
    db.review.seed({
      shopId: shop.id,
      rating: 5,
      body: "Great",
      authorName: "A",
      status: "published",
    });
    for (const id of ["1", "2", "1"]) {
      db.aiGeneration.seed({
        shopId: shop.id,
        toolId: "ai-product-faq",
        status: "applied",
        input: { productId: `gid://shopify/Product/${id}` },
      });
    }

    const report = await visibilityReport(store([product(), product()]), shop, {
      themeEditorUrl: EDITOR,
      fetcher: storefront(OPEN),
    });

    expect(report.score).toBe(100);
    expect(new Set(Object.values(state(report)))).toEqual(new Set(["pass"]));
    expect(report.checks.find((item) => item.id === "schema")?.reason).toBe("live");
    expect(report.crawlers).toHaveLength(AI_BOTS.length);
    expect(report.crawlers?.every((bot) => bot.allowed)).toBe(true);
    expect(report.files).toEqual([
      { path: "/llms.txt", url: `${BASE}/llms.txt`, found: true },
      { path: "/agents.md", url: `${BASE}/agents.md`, found: true },
    ]);
    expect(report.passwordProtected).toBe(false);
  });

  it("shows each gap with the way to fix it, and leaves out what the plan doesn't have", async () => {
    shop.plan = "starter";
    const robots =
      "User-agent: *\nDisallow: /cart\n\nUser-agent: OAI-SearchBot\nUser-agent: Claude-User\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /\n";
    const report = await visibilityReport(
      store(
        [
          product({
            description: "Short.",
            seo: { title: null, description: null },
            alts: [null, ""],
          }),
          product({ seo: { title: "Hat", description: " " }, alts: ["Hat", null] }),
        ],
        null,
      ),
      shop,
      { themeEditorUrl: EDITOR, fetcher: storefront({ ...OPEN, "/robots.txt": { body: robots } }) },
    );

    expect(state(report)).toEqual({
      schema: "fail",
      crawlers: "partial",
      descriptions: "partial",
      altText: "fail",
      seoFields: "fail",
      reviews: "fail",
      faq: "locked",
      homeMeta: "fail",
    });
    const fixes = Object.fromEntries(report.checks.map((item) => [item.id, item.fix?.href]));
    expect(fixes).toEqual({
      schema: "/app/tools/ai-seo-schema",
      crawlers: "shopify://admin/themes",
      descriptions: "shopify://admin/products",
      altText: "/app/seo-alt",
      seoFields: "#meta",
      reviews: "/app/tools/product-reviews",
      faq: "/app/plans",
      homeMeta: "shopify://admin/online_store/preferences",
    });
    expect(report.checks.find((item) => item.id === "crawlers")?.params).toEqual({
      bots: "OAI-SearchBot, Claude-User",
      count: 2,
    });
    // মডেল শেখানোর ক্রলার আটকানো মার্চেন্টের পছন্দ: দেখায়, কিন্তু নম্বর কাটে না
    expect(report.crawlers?.find((bot) => bot.token === "GPTBot")?.allowed).toBe(false);
    // (15 × 9/11 + 15 × 1/2 + 15 × 1/4) ÷ 90, FAQ প্ল্যানে নেই বলে বাদ
    expect(report.score).toBe(26);
  });

  it("does not mark down what it could not check on a password-protected store", async () => {
    enable("ai-seo-schema");
    const locked = { url: `${BASE}/password`, body: "<html>Opening soon</html>" };
    const report = await visibilityReport(store([product()]), shop, {
      themeEditorUrl: EDITOR,
      fetcher: storefront({
        "/robots.txt": locked,
        "/llms.txt": locked,
        "/agents.md": locked,
        "/products/linen-shirt": locked,
      }),
    });

    expect(report.passwordProtected).toBe(true);
    expect(report.crawlers).toBeNull();
    expect(report.files.map((file) => file.found)).toEqual([null, null]);
    expect(state(report)).toMatchObject({ schema: "pass", crawlers: "unknown" });
    expect(report.checks.find((item) => item.id === "crawlers")?.value).toBeNull();
  });

  it("notices when the theme or another app repeats the product data", async () => {
    enable("ai-seo-schema");
    const page = `${OUR_PAGE}${ld({ "@context": "https://schema.org", "@type": "Product" })}`;
    const report = await visibilityReport(store([product()]), shop, {
      themeEditorUrl: EDITOR,
      fetcher: storefront({ ...OPEN, "/products/linen-shirt": { body: page } }),
    });
    expect(report.checks.find((item) => item.id === "schema")).toMatchObject({
      state: "partial",
      reason: "duplicates",
      params: { count: 1 },
      fix: { href: "/app/tools/ai-seo-schema", action: "openSettings" },
    });
  });

  it("sends the merchant to the theme editor when the schema is missing from the page", async () => {
    enable("ai-seo-schema");
    const report = await visibilityReport(store([product()]), shop, {
      themeEditorUrl: EDITOR,
      fetcher: storefront({ ...OPEN, "/products/linen-shirt": { body: "<html></html>" } }),
    });
    expect(report.checks.find((item) => item.id === "schema")).toMatchObject({
      state: "partial",
      reason: "missing",
      fix: { href: EDITOR, action: "embed" },
    });
  });

  it("treats a missing robots.txt as open, and an offline store as unknown", async () => {
    const missing = await visibilityReport(store([product()]), shop, {
      themeEditorUrl: EDITOR,
      fetcher: storefront({ ...OPEN, "/robots.txt": { status: 404 } }),
    });
    expect(state(missing).crawlers).toBe("pass");
    const offline = await visibilityReport(store([product()]), shop, {
      themeEditorUrl: EDITOR,
      fetcher: storefront({}),
    });
    expect(state(offline).crawlers).toBe("unknown");
    expect(offline.files.map((file) => file.found)).toEqual([null, null]);
  });
});

describe("product data on a page", () => {
  it("counts the app's own product data apart from the theme's", () => {
    const html = [
      ld({ "@type": "Product" }, true),
      ld({ "@graph": [{ "@type": "Organization" }, { "@type": ["Product", "Thing"] }] }),
      ld([{ "@type": "BreadcrumbList" }, { "@type": "Product" }]),
      `<script type="application/ld+json">{ broken json </script>`,
      `<script type='application/ld+json' data-app-schema>{"@type":"BreadcrumbList"}</script>`,
    ].join("\n");
    expect(productSchemas(html)).toEqual({ ours: 1, others: 2 });
  });

  it("scores only what was checked", () => {
    const item = (weight: number, value: number | null) => ({
      id: "schema" as const,
      weight,
      value,
      state: "pass" as const,
      reason: "",
      params: {},
      fix: null,
    });
    expect(scoreOf([item(20, 1), item(10, 0), item(10, null)])).toBe(67);
    expect(scoreOf([item(10, null)])).toBeNull();
  });
});
