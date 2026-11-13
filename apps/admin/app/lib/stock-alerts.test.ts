import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));

type Graphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;
/** ব্যাকগ্রাউন্ড কাজ যে Admin API client পায় (আসলটা সেভ করা token দিয়ে বানানো হয়) */
let jobAdmin: { graphql: Graphql };
vi.mock("./admin-client.server", async (original) => ({
  ...(await original<typeof import("./admin-client.server")>()),
  offlineAdmin: async () => jobAdmin,
}));

const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { runJob } = await import("./queue.server");
const { notifyBackInStock, queueStockCheck, requestStockAlert } =
  await import("./stock-alerts.server");

const now = new Date("2026-11-10T10:00:00Z");
let shop: { id: string; domain: string; plan: string | null };

interface VariantStock {
  id: number;
  available: boolean;
  title?: string;
}

/** Shopify-র উত্তর: প্রোডাক্ট, আর তার প্রতিটা ভ্যারিয়েন্ট এখন কেনা যায় কিনা */
const stock = (variants: VariantStock[], extra: Record<string, unknown> = {}) => ({
  product: {
    title: "Blue Shirt",
    status: "ACTIVE",
    onlineStoreUrl: "https://tom.example/products/blue-shirt",
    variants: {
      nodes: variants.map((variant) => ({
        id: `gid://shopify/ProductVariant/${variant.id}`,
        title: variant.title ?? "Large",
        availableForSale: variant.available,
      })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    ...extra,
  },
});
const admin = (responses: unknown[]) => ({
  graphql: vi.fn<Graphql>(async () => Response.json({ data: responses.shift() })),
});
/** products/update webhook-এর যেটুকু আমরা পড়ি */
const updated = (id: number | string = 77) => ({ id, updated_at: "2026-11-10T10:00:00Z" });
const ask = (email: string, extra: Record<string, unknown> = {}) =>
  requestStockAlert(shop, { productId: "77", variantId: "501", email, ...extra }, now);

beforeEach(() => {
  resetFakeDb();
  const row = db.shop.seed({ domain: "tom.myshopify.com", plan: "professional" });
  shop = { id: row.id as string, domain: "tom.myshopify.com", plan: "professional" };
  db.toolSetting.seed({ shopId: shop.id, toolId: "back-in-stock", enabled: true, settings: {} });
});

describe("requestStockAlert", () => {
  it("saves one waiting request per variant and email", async () => {
    expect(await ask(" Rahim@Example.com ")).toBe("saved");
    expect(await ask("rahim@example.com")).toBe("exists");
    expect(db.stockAlert.rows).toHaveLength(1);
    expect(db.stockAlert.rows[0]).toMatchObject({
      productId: "77",
      variantId: "501",
      email: "rahim@example.com",
      status: "waiting",
    });
  });

  it("rejects bad input and does nothing while the tool is off", async () => {
    expect(await ask("not-an-email")).toBe("invalid");
    expect(
      await requestStockAlert(shop, { productId: "77; drop", variantId: "501", email: "a@b.co" }),
    ).toBe("invalid");
    db.toolSetting.rows[0]!.enabled = false;
    expect(await ask("a@b.co")).toBe("disabled");
    expect(db.stockAlert.rows).toHaveLength(0);
  });

  it("adds the buyer to the newsletter only when they tick the box", async () => {
    await ask("no@example.com");
    expect(db.subscriber.rows).toHaveLength(0);
    await ask("yes@example.com", { newsletter: true });
    expect(db.subscriber.rows).toMatchObject([
      { email: "yes@example.com", source: "back-in-stock", status: "subscribed" },
    ]);
  });

  it("ignores the newsletter tick when the merchant turned that option off", async () => {
    db.toolSetting.rows[0]!.settings = { offerNewsletter: false };
    await ask("yes@example.com", { newsletter: true });
    expect(db.subscriber.rows).toHaveLength(0);
  });

  it("stops one address from piling up requests", async () => {
    for (let i = 0; i < 50; i++) {
      db.stockAlert.seed({ shopId: shop.id, productId: "1", variantId: `v${i}`, email: "a@b.co" });
    }
    expect(await ask("a@b.co")).toBe("too_many");
  });

  it("sends the event to connected email tools", async () => {
    db.integration.seed({ shopId: shop.id, provider: "klaviyo", secret: "x" });
    await ask("a@b.co");
    expect(db.job.rows).toMatchObject([
      {
        kind: "esp-sync",
        payload: {
          provider: "klaviyo",
          action: "event",
          source: "back-in-stock",
          event: { email: "a@b.co", name: "Back in stock requested" },
        },
      },
    ]);
  });
});

describe("queueStockCheck", () => {
  it("queues one delayed stock check when someone waits for a variant of the updated product", async () => {
    await ask("a@b.co");
    expect(await queueStockCheck(shop, updated(), now)).toBe(true);
    expect(db.job.rows).toMatchObject([
      { kind: "stock-check:77", status: "pending", payload: { productId: "77" } },
    ]);
    expect((db.job.rows[0]?.runAt as Date).getTime()).toBe(now.getTime() + 30_000);
    // পরপর আরও আপডেট এলে নতুন কাজ জমে না
    expect(await queueStockCheck(shop, updated(), now)).toBe(false);
    expect(db.job.rows).toHaveLength(1);
  });

  it("does nothing when nobody waits for that product, or while the tool is off", async () => {
    expect(await queueStockCheck(shop, updated(), now)).toBe(false);
    await ask("a@b.co");
    // অন্য প্রোডাক্টের আপডেট
    expect(await queueStockCheck(shop, updated(78), now)).toBe(false);
    expect(await queueStockCheck(shop, updated("77; drop"), now)).toBe(false);
    expect(await queueStockCheck(shop, {}, now)).toBe(false);
    db.toolSetting.rows[0]!.enabled = false;
    expect(await queueStockCheck(shop, updated(), now)).toBe(false);
    expect(db.job.rows).toHaveLength(0);
  });

  it("queues a fresh check when the earlier one has already started", async () => {
    await ask("a@b.co");
    await queueStockCheck(shop, updated(), now);
    // চলতে থাকা কাজ হয়তো পুরোনো স্টক পড়ে ফেলেছে
    db.job.rows[0]!.status = "running";
    expect(await queueStockCheck(shop, updated(), now)).toBe(true);
    expect(db.job.rows).toHaveLength(2);
  });
});

describe("notifyBackInStock", () => {
  it("emails everyone waiting once Shopify says the variant can be bought", async () => {
    await ask("a@b.co");
    await ask("c@d.co");
    const soldOut = admin([stock([{ id: 501, available: false }])]);
    expect(await notifyBackInStock(soldOut, shop, "77", now)).toEqual({ notified: 0, more: false });
    expect(soldOut.graphql.mock.calls[0]?.[1]).toEqual({
      variables: { id: "gid://shopify/Product/77", first: 250, after: null },
    });
    expect(db.message.rows).toHaveLength(0);

    const back = admin([stock([{ id: 501, available: true }])]);
    expect(await notifyBackInStock(back, shop, "77", now)).toEqual({ notified: 2, more: false });
    expect(db.message.rows).toHaveLength(2);
    expect(db.message.rows[0]).toMatchObject({
      channel: "email",
      kind: "back-in-stock",
      recipient: "a@b.co",
      refId: "77",
      payload: {
        marketing: false,
        vars: { product: "Blue Shirt (Large)" },
        content: {
          subject: "{product} is back in stock",
          buttonUrl: "https://tom.example/products/blue-shirt?variant=501",
        },
      },
    });
    expect(db.stockAlert.rows.map((r) => r.status)).toEqual(["notified", "notified"]);

    // কাজটা আবার চললে দ্বিতীয়বার যায় না
    const again = admin([stock([{ id: 501, available: true }])]);
    expect(await notifyBackInStock(again, shop, "77", now)).toEqual({ notified: 0, more: false });
    expect(db.message.rows).toHaveLength(2);
  });

  it("emails only the people whose own variant is available", async () => {
    await ask("large@b.co");
    await requestStockAlert(shop, { productId: "77", variantId: "502", email: "small@b.co" }, now);
    const client = admin([
      stock([
        { id: 501, available: false },
        { id: 502, available: true, title: "Small" },
      ]),
    ]);
    expect(await notifyBackInStock(client, shop, "77", now)).toEqual({ notified: 1, more: false });
    expect(db.message.rows).toMatchObject([
      { recipient: "small@b.co", payload: { vars: { product: "Blue Shirt (Small)" } } },
    ]);
    expect(db.stockAlert.rows.map((r) => [r.email, r.status])).toEqual([
      ["large@b.co", "waiting"],
      ["small@b.co", "notified"],
    ]);
  });

  it("sends nothing for a product shoppers cannot open: draft, unpublished or deleted", async () => {
    await ask("a@b.co");
    const variants = [{ id: 501, available: true }];
    for (const response of [
      stock(variants, { status: "DRAFT" }),
      stock(variants, { status: "ARCHIVED" }),
      stock(variants, { onlineStoreUrl: null }),
      { product: null },
    ]) {
      expect(await notifyBackInStock(admin([response]), shop, "77", now)).toEqual({
        notified: 0,
        more: false,
      });
    }
    expect(db.message.rows).toHaveLength(0);
    expect(db.stockAlert.rows[0]?.status).toBe("waiting");
  });

  it("keeps people waiting while the tool is off, without asking Shopify", async () => {
    await ask("a@b.co");
    db.toolSetting.rows[0]!.enabled = false;
    const client = admin([stock([{ id: 501, available: true }])]);
    expect(await notifyBackInStock(client, shop, "77", now)).toEqual({ notified: 0, more: false });
    expect(client.graphql).not.toHaveBeenCalled();
    expect(db.stockAlert.rows[0]?.status).toBe("waiting");
  });

  it("lets a buyer ask again after being notified, and emails them again", async () => {
    await ask("a@b.co");
    await notifyBackInStock(admin([stock([{ id: 501, available: true }])]), shop, "77", now);
    const later = new Date(now.getTime() + 86_400_000);
    expect(
      await requestStockAlert(shop, { productId: "77", variantId: "501", email: "a@b.co" }, later),
    ).toBe("saved");
    const client = admin([stock([{ id: 501, available: true }])]);
    expect(await notifyBackInStock(client, shop, "77", later)).toEqual({
      notified: 1,
      more: false,
    });
    expect(db.message.rows).toHaveLength(2);
  });

  it("leaves the variant name out when the product has no real variants", async () => {
    await ask("a@b.co");
    const client = admin([stock([{ id: 501, available: true, title: "Default Title" }])]);
    await notifyBackInStock(client, shop, "77", now);
    expect(db.message.rows[0]?.payload).toMatchObject({ vars: { product: "Blue Shirt" } });
  });

  it("reads every page of a product with many variants", async () => {
    await ask("a@b.co");
    const first = stock([{ id: 400, available: true }]);
    first.product.variants.pageInfo = { hasNextPage: true, endCursor: "c1" } as never;
    const client = admin([first, stock([{ id: 501, available: true }])]);
    expect(await notifyBackInStock(client, shop, "77", now)).toEqual({ notified: 1, more: false });
    expect(client.graphql.mock.calls[1]?.[1]?.variables).toMatchObject({ after: "c1" });
  });

  it("stops at 500 emails per run and asks to run again for the rest", async () => {
    for (let i = 0; i < 501; i++) {
      db.stockAlert.seed({
        shopId: shop.id,
        productId: "77",
        variantId: "501",
        email: `p${i}@b.co`,
      });
    }
    const response = () => stock([{ id: 501, available: true }]);
    expect(await notifyBackInStock(admin([response()]), shop, "77", now)).toEqual({
      notified: 500,
      more: true,
    });
    expect(await notifyBackInStock(admin([response()]), shop, "77", now)).toEqual({
      notified: 1,
      more: false,
    });
    expect(db.message.rows).toHaveLength(501);
  });
});

describe("the stock check job", () => {
  const context = (row: Record<string, unknown>) => ({
    id: row.id as string,
    shopId: row.shopId as string,
    kind: row.kind as string,
    payload: row.payload as Record<string, unknown>,
    attempts: 1,
  });

  it("runs for the product named in the job and emails the people waiting", async () => {
    await ask("a@b.co");
    await queueStockCheck(shop, updated(), now);
    jobAdmin = admin([stock([{ id: 501, available: true }])]);
    await runJob(context(db.job.rows[0] as Record<string, unknown>));
    expect(db.job.rows[0]).toMatchObject({ kind: "stock-check:77", status: "done", error: null });
    expect(db.message.rows).toMatchObject([{ recipient: "a@b.co", kind: "back-in-stock" }]);
  });

  it("does nothing for a store that uninstalled the app", async () => {
    await ask("a@b.co");
    await queueStockCheck(shop, updated(), now);
    db.shop.rows[0]!.uninstalledAt = new Date();
    jobAdmin = admin([stock([{ id: 501, available: true }])]);
    await runJob(context(db.job.rows[0] as Record<string, unknown>));
    expect(jobAdmin.graphql).not.toHaveBeenCalled();
    expect(db.message.rows).toHaveLength(0);
  });
});
