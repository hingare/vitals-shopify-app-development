import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { fillPage, hasImageWithoutAlt, queueNewImages, renderAlt, startAltJob, undoPage } =
  await import("./seo-alt.server");

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

const image = (id: string, alt: string | null, extra: Record<string, unknown> = {}) => ({
  id: `gid://shopify/MediaImage/${id}`,
  alt,
  fileStatus: "READY",
  createdAt: "2026-11-01T00:00:00Z",
  ...extra,
});
const media = (nodes: unknown[], next: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: next !== null, endCursor: next },
});
const product = (id: string, title: string, nodes: unknown[], next: string | null = null) => ({
  id: `gid://shopify/Product/${id}`,
  title,
  vendor: "Acme",
  productType: "",
  media: media(nodes, next),
});
const productsPage = (nodes: unknown[], next: string | null = null) => ({
  shop: { name: "Tom's Shop" },
  products: { nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } },
});
/** fileUpdate: দেওয়া id ছাড়া বাকি সব সফল */
const updater =
  (failing: string[] = []) =>
  (variables: Variables) => {
    const files = variables.files as Array<{ id: string; alt: string }>;
    const bad = files.some((file) => failing.includes(file.id));
    // Shopify-র মতো: ব্যাচে একটা খারাপ থাকলে পুরো ব্যাচ ফেরত
    return { fileUpdate: { files: bad ? [] : files.map((file) => ({ id: file.id })) } };
  };

let shop: { id: string; plan: string | null };
const changes = () =>
  db.altTextChange.rows.map((row) => [String(row.mediaId).split("/").pop(), row.newAlt]);

beforeEach(() => {
  resetFakeDb();
  const row = db.shop.seed({ domain: "tom.myshopify.com" });
  shop = { id: row.id as string, plan: "professional" };
});

describe("alt text pattern", () => {
  const context = { product: "Blue T-Shirt", vendor: "Acme", type: "Shirts", shop: "Tom's Shop" };

  it("fills in the product, vendor, type and shop", () => {
    expect(renderAlt("{product} - {shop}", context)).toBe("Blue T-Shirt - Tom's Shop");
    expect(renderAlt("{vendor} {product} ({type})", context)).toBe("Acme Blue T-Shirt (Shirts)");
  });

  it("leaves no stray separators when a value is empty", () => {
    const bare = { ...context, vendor: "", type: "" };
    expect(renderAlt("{product} - {vendor} - {shop}", bare)).toBe("Blue T-Shirt - Tom's Shop");
    expect(renderAlt("{vendor}: {product}", bare)).toBe("Blue T-Shirt");
    expect(renderAlt("{vendor} {product} ({type})", bare)).toBe("Blue T-Shirt");
    expect(renderAlt("{product} | {type}", bare)).toBe("Blue T-Shirt");
    expect(renderAlt("{vendor} - {type}", bare)).toBe("");
  });

  it("never changes the words inside a value", () => {
    const odd = { ...context, product: "Size: -5 to 5 / Kids", vendor: "" };
    expect(renderAlt("{product} - {vendor} - {shop}", odd)).toBe(
      "Size: -5 to 5 / Kids - Tom's Shop",
    );
  });

  it("never puts an unknown {name} or its braces into the alt text", () => {
    expect(renderAlt("{title} - {product}", context)).toBe("Blue T-Shirt");
    expect(renderAlt("{constructor} {product}", context)).toBe("Blue T-Shirt");
  });

  it("keeps to the length Shopify allows", () => {
    const long = renderAlt("{product}", { ...context, product: "word ".repeat(200) });
    expect(long.length).toBeLessThanOrEqual(512);
    expect(long.endsWith(" ")).toBe(false);
  });
});

describe("filling in missing alt text", () => {
  it("writes only where there is none, and remembers what it wrote", async () => {
    const admin = fakeAdmin({
      AltProducts: () =>
        productsPage(
          [
            product("1", "Blue Shirt", [
              image("11", null),
              image("12", "Hand written"),
              image("13", "  "),
              // এখনো প্রসেস হচ্ছে: Shopify বদলাতে দেয় না
              image("14", null, { fileStatus: "PROCESSING" }),
              // ভিডিও ইত্যাদি: MediaImage নয়, তাই ফাঁকা আসে
              {},
            ]),
            product("2", "Red Cap", [image("21", "")]),
          ],
          "cursor-2",
        ),
      AltUpdate: updater(),
    });

    const result = await fillPage(admin, shop.id, "{product} - {shop}", { cursor: null });

    expect(result).toEqual({ scanned: 2, updated: 3, next: "cursor-2" });
    expect(admin.calls[1]).toEqual([
      "AltUpdate",
      {
        files: [
          { id: "gid://shopify/MediaImage/11", alt: "Blue Shirt - Tom's Shop" },
          { id: "gid://shopify/MediaImage/13", alt: "Blue Shirt - Tom's Shop" },
          { id: "gid://shopify/MediaImage/21", alt: "Red Cap - Tom's Shop" },
        ],
      },
    ]);
    expect(changes()).toEqual([
      ["11", "Blue Shirt - Tom's Shop"],
      ["13", "Blue Shirt - Tom's Shop"],
      ["21", "Red Cap - Tom's Shop"],
    ]);
    expect(db.altTextChange.rows[0]).toMatchObject({
      shopId: shop.id,
      productId: "gid://shopify/Product/1",
      oldAlt: "",
    });
  });

  it("reads every image of a product with many images", async () => {
    const admin = fakeAdmin({
      AltProducts: () => productsPage([product("1", "Blue Shirt", [image("11", null)], "m1")]),
      AltProductMedia: (variables) => ({
        product: {
          media:
            variables.after === "m1" ? media([image("12", null)], "m2") : media([image("13", "")]),
        },
      }),
      AltUpdate: updater(),
    });

    expect(await fillPage(admin, shop.id, "{product}", { cursor: null })).toEqual({
      scanned: 1,
      updated: 3,
      next: null,
    });
    expect(admin.calls.map(([name, variables]) => [name, variables.after])).toEqual([
      ["AltProducts", null],
      ["AltProductMedia", "m1"],
      ["AltProductMedia", "m2"],
      ["AltUpdate", undefined],
    ]);
  });

  it("does not let one refused image hold back the others, and forgets the refused one", async () => {
    const admin = fakeAdmin({
      AltProducts: () =>
        productsPage([product("1", "Blue Shirt", [image("11", null), image("12", null)])]),
      AltUpdate: updater(["gid://shopify/MediaImage/12"]),
    });

    const result = await fillPage(admin, shop.id, "{product}", { cursor: null });

    expect(result.updated).toBe(1);
    // প্রথমে একসাথে, তারপর একটা একটা করে
    expect(admin.calls.filter(([name]) => name === "AltUpdate")).toHaveLength(3);
    expect(changes()).toEqual([["11", "Blue Shirt"]]);
  });

  it("does nothing when the pattern comes out empty", async () => {
    const admin = fakeAdmin({
      AltProducts: () => productsPage([product("1", "Blue Shirt", [image("11", null)])]),
    });
    const result = await fillPage(admin, shop.id, "{type}", { cursor: null });
    expect(result.updated).toBe(0);
    expect(admin.calls).toHaveLength(1);
    expect(db.altTextChange.rows).toHaveLength(0);
  });

  it("can stick to images added after a given time", async () => {
    const admin = fakeAdmin({
      AltProducts: () =>
        productsPage([
          product("1", "Blue Shirt", [
            image("11", null, { createdAt: "2026-11-10T09:00:00Z" }),
            image("12", null, { createdAt: "2026-11-10T11:00:00Z" }),
          ]),
        ]),
      AltUpdate: updater(),
    });

    await fillPage(admin, shop.id, "{product}", {
      cursor: null,
      query: "updated_at:>='2026-11-10T10:00:00.000Z'",
      createdSince: new Date("2026-11-10T10:00:00Z"),
    });

    expect(admin.calls[0]?.[1].query).toBe("updated_at:>='2026-11-10T10:00:00.000Z'");
    expect(changes()).toEqual([["12", "Blue Shirt"]]);
  });
});

describe("undoing", () => {
  const seed = (id: string, newAlt: string) =>
    db.altTextChange.seed({
      shopId: shop.id,
      mediaId: `gid://shopify/MediaImage/${id}`,
      productId: "gid://shopify/Product/1",
      oldAlt: "",
      newAlt,
    });

  it("removes only the alt text that is still ours", async () => {
    seed("11", "Blue Shirt");
    seed("12", "Blue Shirt");
    seed("13", "Blue Shirt");
    const admin = fakeAdmin({
      AltCurrent: () => ({
        nodes: [
          image("11", "Blue Shirt"),
          // মার্চেন্ট পরে নিজে লিখেছেন
          image("12", "A model wearing the blue shirt"),
          // ছবিটা মুছে ফেলা হয়েছে
          null,
        ],
      }),
      AltUpdate: updater(),
    });

    expect(await undoPage(admin, shop.id, null)).toEqual({ restored: 1, kept: 2, next: null });
    expect(admin.calls[1]).toEqual([
      "AltUpdate",
      { files: [{ id: "gid://shopify/MediaImage/11", alt: "" }] },
    ]);
    expect(db.altTextChange.rows).toHaveLength(0);
  });

  it("keeps the record of an image it could not restore, so it can be tried again", async () => {
    seed("11", "Blue Shirt");
    seed("12", "Blue Shirt");
    const admin = fakeAdmin({
      AltCurrent: () => ({ nodes: [image("11", "Blue Shirt"), image("12", "Blue Shirt")] }),
      AltUpdate: updater(["gid://shopify/MediaImage/12"]),
    });

    expect(await undoPage(admin, shop.id, null)).toMatchObject({ restored: 1, kept: 0 });
    expect(changes()).toEqual([["12", "Blue Shirt"]]);
  });

  it("has nothing to do when nothing was written", async () => {
    const admin = fakeAdmin({});
    expect(await undoPage(admin, shop.id, null)).toEqual({ restored: 0, kept: 0, next: null });
    expect(admin.calls).toHaveLength(0);
  });
});

describe("starting a run", () => {
  it("runs one fill or undo at a time", async () => {
    expect(await startAltJob(shop.id, "alt-fill")).toBe(true);
    expect(await startAltJob(shop.id, "alt-undo")).toBe(false);
    expect(await startAltJob(shop.id, "alt-fill")).toBe(false);
    db.job.rows[0]!.status = "done";
    expect(await startAltJob(shop.id, "alt-undo")).toBe(true);
    expect(db.job.rows.map((job) => job.kind)).toEqual(["alt-fill", "alt-undo"]);
  });
});

describe("new product images", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const enable = (settings: Record<string, unknown> = {}) =>
    db.toolSetting.seed({ shopId: shop.id, toolId: "seo-alt-tags", enabled: true, settings });
  const missing = { images: [{ alt: "Front" }, { alt: null }] };

  it("spots an image without alt text in the product webhook", () => {
    expect(hasImageWithoutAlt({ images: [{ alt: "Front" }, { alt: " " }] })).toBe(true);
    expect(hasImageWithoutAlt({ images: [{ alt: "Front" }] })).toBe(false);
    expect(hasImageWithoutAlt({ images: [] })).toBe(false);
    expect(
      hasImageWithoutAlt({
        images: [{ alt: "Front" }],
        media: [
          { alt: null, media_content_type: "VIDEO" },
          { alt: "Front", media_content_type: "IMAGE" },
        ],
      }),
    ).toBe(false);
    expect(hasImageWithoutAlt({ media: [{ alt: "", media_content_type: "IMAGE" }] })).toBe(true);
    // তালিকাই না এলে নিশ্চিত হওয়া যায় না
    expect(hasImageWithoutAlt({})).toBe(true);
  });

  it("queues one delayed job however many webhooks arrive", async () => {
    enable();
    expect(await queueNewImages(shop, missing, now)).toBe(true);
    expect(await queueNewImages(shop, missing, now)).toBe(false);
    expect(db.job.rows).toHaveLength(1);
    expect(db.job.rows[0]).toMatchObject({
      kind: "alt-new",
      payload: { since: "2026-11-10T11:45:00.000Z" },
      runAt: new Date("2026-11-10T12:01:00Z"),
    });
  });

  it("queues again while an earlier job is already running", async () => {
    enable();
    await queueNewImages(shop, missing, now);
    db.job.rows[0]!.status = "running";
    expect(await queueNewImages(shop, missing, now)).toBe(true);
  });

  it("stays quiet when the tool or the automatic option is off, or nothing is missing", async () => {
    expect(await queueNewImages(shop, missing, now)).toBe(false);
    enable({ autoNew: false });
    expect(await queueNewImages(shop, missing, now)).toBe(false);
    db.toolSetting.rows[0]!.settings = {};
    expect(await queueNewImages(shop, { images: [{ alt: "Front" }] }, now)).toBe(false);
    expect(await queueNewImages({ ...shop, plan: "starter" }, missing, now)).toBe(false);
    expect(db.job.rows).toHaveLength(0);
  });

  it("does not write alt text back right after the merchant removed it", async () => {
    enable();
    const undo = db.job.seed({ shopId: shop.id, kind: "alt-undo", status: "running" });
    expect(await queueNewImages(shop, missing, now)).toBe(false);
    undo.status = "done";
    undo.finishedAt = new Date("2026-11-10T11:50:00Z");
    expect(await queueNewImages(shop, missing, now)).toBe(false);
    undo.finishedAt = new Date("2026-11-10T11:30:00Z");
    expect(await queueNewImages(shop, missing, now)).toBe(true);
  });
});
