import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db.server", async () => ({ default: (await import("../test-db")).fakeDb }));
vi.mock("../admin-client.server", async (original) => ({
  ...(await original<typeof import("../admin-client.server")>()),
  offlineAdmin: async () => ({ graphql: vi.fn() }),
}));
const { fakeDb: db, resetFakeDb } = await import("../test-db");
const { setAiClientForTests } = await import("./claude.server");
const { handleToolAction } = await import("./tool-page.server");
await import("./tasks.server");

const PRODUCT = "gid://shopify/Product/1";
const media = (n: number, alt: string) => ({
  id: `gid://shopify/MediaImage/${n}`,
  alt,
  image: { url: `https://cdn.shopify.com/p${n}.jpg` },
});

/** Shopify-র নকল: প্রোডাক্ট পড়া আর ছবির alt বসানো */
const alts: Record<string, string> = {};
const admin = {
  graphql: vi.fn(async (query: string, options?: { variables?: Record<string, unknown> }) => {
    const variables = options?.variables ?? {};
    let data: unknown;
    if (query.includes("query AiProduct")) {
      data = {
        product: {
          id: PRODUCT,
          title: "Linen Shirt",
          handle: "linen-shirt",
          vendor: "Acme",
          productType: "Shirt",
          tags: [],
          descriptionHtml: "<p>Old</p>",
          seo: { title: null, description: null },
          options: [],
          priceRangeV2: null,
          media: { nodes: [media(1, ""), media(2, "Already written"), media(3, " ")] },
        },
      };
    } else if (query.includes("query AiImageAltNow")) {
      const id = String(variables.id ?? "");
      data = { node: { id, alt: alts[id] ?? "" } };
    } else if (query.includes("mutation AiImageAlt(")) {
      const files = variables.files as Array<{ id: string; alt: string }>;
      for (const file of files) alts[file.id] = file.alt;
      data = { fileUpdate: { userErrors: [] } };
    } else {
      throw new Error(`Unexpected query: ${query.slice(0, 60)}`);
    }
    return new Response(JSON.stringify({ data }));
  }),
};

let shop: { id: string; domain: string; plan: string; trialEndsAt: Date | null };

beforeEach(() => {
  resetFakeDb();
  for (const key of Object.keys(alts)) delete alts[key];
  setAiClientForTests({ beta: { messages: { stream: vi.fn() } } } as never);
  const row = db.shop.seed({
    domain: "a.myshopify.com",
    plan: "professional",
    uninstalledAt: null,
  });
  shop = {
    id: row.id as string,
    domain: "a.myshopify.com",
    plan: "professional",
    trialEndsAt: null,
  };
});

afterEach(() => setAiClientForTests(null));

const start = (onlyMissing: boolean) =>
  handleToolAction(shop, admin, "ai-alt-text", {
    intent: "start",
    input: { productId: PRODUCT, onlyMissing },
  });

describe("AI tool page actions", () => {
  it("starts one alt text task per photo that has no alt text yet", async () => {
    expect(await start(true)).toMatchObject({ ok: true, intent: "start", count: 2 });
    const rows = db.aiGeneration.rows;
    expect(rows.map((r) => r.targetId)).toEqual([
      "gid://shopify/MediaImage/1",
      "gid://shopify/MediaImage/3",
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Linen Shirt · #1", "Linen Shirt · #3"]);
    expect(new Set(rows.map((r) => r.batchId)).size).toBe(1);
    expect(rows[0]?.input).toMatchObject({ imageUrl: "https://cdn.shopify.com/p1.jpg?width=240" });
    expect(db.job.rows).toHaveLength(2);
  });

  it("covers every photo when asked, and says so when nothing is left to write", async () => {
    expect(await start(false)).toMatchObject({ ok: true, count: 3 });
    resetFakeDb();
    const row = db.shop.seed({ domain: shop.domain, plan: "professional", uninstalledAt: null });
    shop.id = row.id as string;
    admin.graphql.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              product: {
                id: PRODUCT,
                title: "Linen Shirt",
                handle: "x",
                vendor: null,
                productType: null,
                tags: [],
                descriptionHtml: null,
                seo: { title: null, description: null },
                options: [],
                priceRangeV2: null,
                media: { nodes: [media(2, "Already written")] },
              },
            },
          }),
        ),
    );
    expect(await start(true)).toEqual({ ok: false, intent: "start", error: "nothing" });
  });

  it("does not start when the month's credits are used up or AI is not set up", async () => {
    db.usageCounter.seed({
      shopId: shop.id,
      meter: "ai",
      month: new Date().toISOString().slice(0, 7),
      used: 3_000_000,
    });
    expect(await start(true)).toEqual({ ok: false, intent: "start", error: "budget" });
    setAiClientForTests(null);
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(await start(true)).toEqual({ ok: false, intent: "start", error: "not_configured" });
    if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    expect(db.aiGeneration.rows).toHaveLength(0);
  });

  it("saves every ready result at once, using the merchant's edits", async () => {
    await start(true);
    const [first, second] = db.aiGeneration.rows;
    for (const [row, alt] of [
      [first!, "A white linen shirt"],
      [second!, "Shirt collar close-up"],
    ] as const) {
      row.status = "ready";
      row.output = { alt };
    }
    const result = await handleToolAction(shop, admin, "ai-alt-text", {
      intent: "applyAll",
      edits: { [second!.id as string]: { alt: "Edited by the merchant" } },
    });
    expect(result).toEqual({ ok: true, intent: "applyAll", count: 2, failed: 0 });
    expect(alts).toEqual({
      "gid://shopify/MediaImage/1": "A white linen shirt",
      "gid://shopify/MediaImage/3": "Edited by the merchant",
    });
    expect(db.aiGeneration.rows.map((r) => r.status)).toEqual(["applied", "applied"]);
  });

  it("tries a failed task again as a new one and drops the failed one", async () => {
    await start(true);
    const failed = db.aiGeneration.rows[0]!;
    failed.status = "failed";
    failed.error = "busy";
    const result = await handleToolAction(shop, admin, "ai-alt-text", {
      intent: "retry",
      id: failed.id,
    });
    expect(result).toMatchObject({ ok: true, intent: "retry" });
    expect(failed.status).toBe("discarded");
    const again = db.aiGeneration.rows[db.aiGeneration.rows.length - 1]!;
    expect(again).toMatchObject({
      status: "queued",
      targetId: failed.targetId,
      label: failed.label,
    });
  });

  it("rejects unknown actions and tools outside the AI Studio", async () => {
    expect(await handleToolAction(shop, admin, "ai-alt-text", { intent: "explode" })).toEqual({
      ok: false,
      intent: "unknown",
      error: "invalid",
    });
    expect(
      await handleToolAction(shop, admin, "sticky-atc", { intent: "discard", id: "x" }),
    ).toMatchObject({ ok: false, error: "invalid" });
  });
});
