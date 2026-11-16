import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const {
  DESCRIPTION_MAX,
  TITLE_MAX,
  fillPage,
  metaOverview,
  queueNewMeta,
  renderMeta,
  startMetaJob,
  undoPage,
} = await import("./seo-meta.server");

type Variables = Record<string, unknown>;

/** নকল Admin API: operation-এর নাম দেখে উত্তর দেয়, আর কী কী ডাকা হলো মনে রাখে */
function fakeAdmin(handlers: Record<string, (variables: Variables) => unknown>) {
  const calls: Array<[string, Variables]> = [];
  const graphql = vi.fn(async (query: string, options?: { variables?: Variables }) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
    const variables = options?.variables ?? {};
    calls.push([name, variables]);
    const handler = handlers[name];
    if (!handler) throw new Error(`Unexpected operation ${name}`);
    return new Response(JSON.stringify({ data: handler(variables) }));
  });
  return { graphql, calls };
}

const TEMPLATES = {
  productTitle: "{product} | {shop}",
  productDescription: "{description}",
  collectionTitle: "{collection} | {shop}",
  collectionDescription: "Shop {collection} at {shop}. {description}",
};

const item = (
  kind: "Product" | "Collection",
  id: string,
  title: string,
  seo: { title?: string | null; description?: string | null } = {},
  description = "",
) => ({
  id: `gid://shopify/${kind}/${id}`,
  title,
  description,
  vendor: kind === "Product" ? "Acme" : undefined,
  productType: kind === "Product" ? "Shirts" : undefined,
  seo: { title: seo.title ?? null, description: seo.description ?? null },
});
const page = (key: "products" | "collections", nodes: unknown[], next: string | null = null) => ({
  shop: { name: "Tom's Shop" },
  [key]: { nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } },
});
/** productUpdate বা collectionUpdate: দেওয়া id ছাড়া বাকি সব সফল */
const updater =
  (key: "productUpdate" | "collectionUpdate", failing: string[] = []) =>
  (variables: Variables) => {
    const input = (variables.product ?? variables.input) as { id: string };
    const errors = failing.includes(input.id) ? [{ field: ["seo"], message: "Invalid" }] : [];
    return { [key]: { userErrors: errors } };
  };

let shop: { id: string; plan: string | null };
const changes = () =>
  db.seoMetaChange.rows.map((row) => [
    String(row.resourceId).split("/").pop(),
    row.field,
    row.newValue,
  ]);

beforeEach(() => {
  resetFakeDb();
  const row = db.shop.seed({ domain: "tom.myshopify.com" });
  shop = { id: row.id as string, plan: "starter" };
});

describe("meta templates", () => {
  const shirt = {
    title: "Linen Shirt",
    vendor: "Acme",
    productType: "Shirts",
    description: "Light and airy.\n\n  Made of linen.",
  };

  it("fills in the product and shop, with the description on one line", () => {
    expect(renderMeta("product", TEMPLATES, shirt, "Tom's Shop")).toEqual({
      title: "Linen Shirt | Tom's Shop",
      description: "Light and airy. Made of linen.",
    });
    expect(
      renderMeta(
        "product",
        { ...TEMPLATES, productTitle: "{vendor} {product} - {type}" },
        { ...shirt, vendor: null, productType: "" },
        "Tom's Shop",
      ).title,
    ).toBe("Linen Shirt");
  });

  it("uses the collection's own names for collections", () => {
    expect(
      renderMeta(
        "collection",
        TEMPLATES,
        { title: "Shirts", description: "Summer shirts." },
        "Tom's Shop",
      ),
    ).toEqual({
      title: "Shirts | Tom's Shop",
      description: "Shop Shirts at Tom's Shop. Summer shirts.",
    });
  });

  it("keeps to the lengths search engines show, without cutting a word", () => {
    const long = { ...shirt, title: "Shirt ".repeat(30), description: "Linen ".repeat(80) };
    const made = renderMeta("product", TEMPLATES, long, "Tom's Shop");
    expect(made.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(made.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(made.title).toMatch(/Shirt$/);
    expect(made.description).toMatch(/Linen$/);
  });
});

describe("filling in empty SEO fields", () => {
  it("writes only the empty fields, sends both, and remembers what it wrote", async () => {
    const admin = fakeAdmin({
      MetaProducts: () =>
        page(
          "products",
          [
            item("Product", "1", "Blue Shirt", {}, "Soft cotton."),
            // মার্চেন্টের নিজের টাইটেল: শুধু বর্ণনা ভরা হয়
            item("Product", "2", "Red Cap", { title: "Caps for summer" }, "A red cap."),
            // দুটোই লেখা: ছোঁয়া হয় না
            item("Product", "3", "Hat", { title: "Hat", description: "A hat." }),
            // বর্ণনা নেই, তাই শুধু টাইটেল
            item("Product", "4", "Socks", { description: "  " }),
          ],
          "cursor-2",
        ),
      MetaProduct: updater("productUpdate"),
    });

    const result = await fillPage(admin, shop.id, "product", TEMPLATES, { cursor: null });

    expect(result).toEqual({ scanned: 4, updated: 3, next: "cursor-2" });
    expect(admin.calls.slice(1)).toEqual([
      [
        "MetaProduct",
        {
          product: {
            id: "gid://shopify/Product/1",
            seo: { title: "Blue Shirt | Tom's Shop", description: "Soft cotton." },
          },
        },
      ],
      [
        "MetaProduct",
        {
          product: {
            id: "gid://shopify/Product/2",
            seo: { title: "Caps for summer", description: "A red cap." },
          },
        },
      ],
      [
        "MetaProduct",
        {
          product: {
            id: "gid://shopify/Product/4",
            seo: { title: "Socks | Tom's Shop", description: "  " },
          },
        },
      ],
    ]);
    expect(changes()).toEqual([
      ["1", "title", "Blue Shirt | Tom's Shop"],
      ["1", "description", "Soft cotton."],
      ["2", "description", "A red cap."],
      ["4", "title", "Socks | Tom's Shop"],
    ]);
  });

  it("forgets what Shopify refused, so undo never touches it", async () => {
    const admin = fakeAdmin({
      MetaProducts: () =>
        page("products", [
          item("Product", "1", "Blue Shirt", {}, "Soft."),
          item("Product", "2", "Red Cap", {}, "Red."),
        ]),
      MetaProduct: updater("productUpdate", ["gid://shopify/Product/2"]),
    });

    expect(await fillPage(admin, shop.id, "product", TEMPLATES, { cursor: null })).toEqual({
      scanned: 2,
      updated: 1,
      next: null,
    });
    expect(changes().map(([id]) => id)).toEqual(["1", "1"]);
  });

  it("fills collections through the collection mutation", async () => {
    const admin = fakeAdmin({
      MetaCollections: () => page("collections", [item("Collection", "9", "Shirts")]),
      MetaCollection: updater("collectionUpdate"),
    });

    await fillPage(admin, shop.id, "collection", TEMPLATES, { cursor: null });

    expect(admin.calls[1]).toEqual([
      "MetaCollection",
      {
        input: {
          id: "gid://shopify/Collection/9",
          seo: { title: "Shirts | Tom's Shop", description: "Shop Shirts at Tom's Shop." },
        },
      },
    ]);
  });

  it("can stick to recently changed products", async () => {
    const admin = fakeAdmin({ MetaProducts: () => page("products", []) });
    await fillPage(admin, shop.id, "product", TEMPLATES, {
      cursor: null,
      query: "updated_at:>='2026-11-10T10:00:00.000Z'",
    });
    expect(admin.calls[0]?.[1]).toMatchObject({
      query: "updated_at:>='2026-11-10T10:00:00.000Z'",
    });
  });
});

describe("undoing", () => {
  const seed = (id: string, field: "title" | "description", newValue: string) =>
    db.seoMetaChange.seed({
      shopId: shop.id,
      resourceId: id.includes("/") ? id : `gid://shopify/Product/${id}`,
      field,
      newValue,
    });

  it("empties only what is still ours and keeps the merchant's later edits", async () => {
    seed("1", "title", "Blue Shirt | Tom's Shop");
    seed("1", "description", "Soft cotton.");
    seed("2", "title", "Red Cap | Tom's Shop");
    seed("3", "title", "Hat | Tom's Shop");
    const admin = fakeAdmin({
      MetaCurrent: () => ({
        nodes: [
          {
            id: "gid://shopify/Product/1",
            // মার্চেন্ট পরে বর্ণনা নিজে লিখেছেন
            seo: { title: "Blue Shirt | Tom's Shop", description: "Our softest shirt." },
          },
          {
            id: "gid://shopify/Product/2",
            seo: { title: "Red Cap | Tom's Shop", description: "" },
          },
          // প্রোডাক্টটা মুছে ফেলা হয়েছে
          null,
        ],
      }),
      MetaProduct: updater("productUpdate"),
    });

    expect(await undoPage(admin, shop.id, null)).toEqual({ restored: 2, kept: 2, next: null });
    expect(admin.calls.slice(1)).toEqual([
      [
        "MetaProduct",
        {
          product: {
            id: "gid://shopify/Product/1",
            seo: { title: "", description: "Our softest shirt." },
          },
        },
      ],
      [
        "MetaProduct",
        { product: { id: "gid://shopify/Product/2", seo: { title: "", description: "" } } },
      ],
    ]);
    expect(db.seoMetaChange.rows).toHaveLength(0);
  });

  it("keeps the record of what it could not restore, so it can be tried again", async () => {
    seed("1", "title", "Blue Shirt");
    seed("gid://shopify/Collection/9", "title", "Shirts");
    const admin = fakeAdmin({
      MetaCurrent: () => ({
        nodes: [
          { id: "gid://shopify/Product/1", seo: { title: "Blue Shirt", description: null } },
          { id: "gid://shopify/Collection/9", seo: { title: "Shirts", description: null } },
        ],
      }),
      MetaProduct: updater("productUpdate", ["gid://shopify/Product/1"]),
      MetaCollection: updater("collectionUpdate"),
    });

    expect(await undoPage(admin, shop.id, null)).toMatchObject({ restored: 1, kept: 0 });
    expect(changes()).toEqual([["1", "title", "Blue Shirt"]]);
  });

  it("has nothing to do when nothing was written", async () => {
    const admin = fakeAdmin({});
    expect(await undoPage(admin, shop.id, null)).toEqual({ restored: 0, kept: 0, next: null });
    expect(admin.calls).toHaveLength(0);
  });
});

describe("starting a run", () => {
  it("runs one fill or undo at a time", async () => {
    expect(await startMetaJob(shop.id, "meta-fill")).toBe(true);
    expect(await startMetaJob(shop.id, "meta-undo")).toBe(false);
    db.job.rows[0]!.status = "done";
    expect(await startMetaJob(shop.id, "meta-undo")).toBe(true);
    expect(db.job.rows.map((job) => job.kind)).toEqual(["meta-fill", "meta-undo"]);
  });
});

describe("new and changed products", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const enable = (settings: Record<string, unknown> = {}) =>
    db.toolSetting.seed({ shopId: shop.id, toolId: "seo-meta-templates", enabled: true, settings });

  it("queues one delayed job however many webhooks arrive", async () => {
    enable();
    expect(await queueNewMeta(shop, now)).toBe(true);
    expect(await queueNewMeta(shop, now)).toBe(false);
    expect(db.job.rows).toHaveLength(1);
    expect(db.job.rows[0]).toMatchObject({
      kind: "meta-new",
      payload: { since: "2026-11-10T11:45:00.000Z" },
      runAt: new Date("2026-11-10T12:01:00Z"),
    });
  });

  it("stays quiet when the tool or the automatic option is off", async () => {
    expect(await queueNewMeta(shop, now)).toBe(false);
    enable({ autoFillNew: false });
    expect(await queueNewMeta(shop, now)).toBe(false);
    expect(await queueNewMeta({ ...shop, plan: null }, now)).toBe(false);
    expect(db.job.rows).toHaveLength(0);
  });

  it("leaves new products to a full run that is already going", async () => {
    enable();
    const fill = db.job.seed({ shopId: shop.id, kind: "meta-fill", status: "running" });
    expect(await queueNewMeta(shop, now)).toBe(false);
    fill.status = "done";
    expect(await queueNewMeta(shop, now)).toBe(true);
  });

  it("does not fill fields again right after the merchant emptied them", async () => {
    enable();
    const undo = db.job.seed({ shopId: shop.id, kind: "meta-undo", status: "running" });
    expect(await queueNewMeta(shop, now)).toBe(false);
    undo.status = "done";
    undo.finishedAt = new Date("2026-11-10T11:50:00Z");
    expect(await queueNewMeta(shop, now)).toBe(false);
    undo.finishedAt = new Date("2026-11-10T11:30:00Z");
    expect(await queueNewMeta(shop, now)).toBe(true);
  });
});

describe("page overview", () => {
  it("shows an example from the merchant's own templates and the last run", async () => {
    db.toolSetting.seed({
      shopId: shop.id,
      toolId: "seo-meta-templates",
      enabled: true,
      settings: { productTitle: "Buy {product} online" },
    });
    db.seoMetaChange.seed({ shopId: shop.id, resourceId: "x", field: "title", newValue: "x" });
    db.job.seed({
      shopId: shop.id,
      kind: "meta-fill",
      status: "done",
      progress: { scanned: 40, updated: 12 },
      finishedAt: new Date("2026-11-10T11:55:00Z"),
    });
    const admin = fakeAdmin({
      MetaSample: () => ({
        shop: { name: "Tom's Shop" },
        products: { nodes: [item("Product", "1", "Blue Shirt", {}, "Soft cotton.")] },
      }),
    });

    expect(await metaOverview(admin, shop, new Date("2026-11-10T12:00:00Z").getTime())).toEqual({
      allowed: true,
      enabled: true,
      autoFillNew: true,
      written: 1,
      example: {
        name: "Blue Shirt",
        title: "Buy Blue Shirt online",
        description: "Soft cotton.",
      },
      job: {
        kind: "meta-fill",
        status: "done",
        error: null,
        active: false,
        recent: true,
        scanned: 40,
        updated: 12,
        restored: 0,
        kept: 0,
      },
    });
  });
});
