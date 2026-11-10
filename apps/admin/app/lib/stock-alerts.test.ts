import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));

const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { notifyBackInStock, purchasableVariants, requestStockAlert } =
  await import("./stock-alerts.server");

const now = new Date("2026-11-10T10:00:00Z");
let shop: { id: string; domain: string; plan: string | null };

const product = (quantity: number, extra: Record<string, unknown> = {}) => ({
  id: 77,
  title: "Blue Shirt",
  handle: "blue-shirt",
  status: "active",
  variants: [
    {
      id: 501,
      title: "Large",
      inventory_quantity: quantity,
      inventory_policy: "deny",
      inventory_management: "shopify",
      ...extra,
    },
  ],
});
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

describe("purchasableVariants", () => {
  it("counts stock, untracked variants and oversell, but not drafts", () => {
    expect([...purchasableVariants(product(0)).keys()]).toEqual([]);
    expect([...purchasableVariants(product(2)).keys()]).toEqual(["501"]);
    expect([...purchasableVariants(product(0, { inventory_policy: "continue" })).keys()]).toEqual([
      "501",
    ]);
    expect([...purchasableVariants(product(0, { inventory_management: null })).keys()]).toEqual([
      "501",
    ]);
    expect([...purchasableVariants({ ...product(5), status: "draft" }).keys()]).toEqual([]);
  });
});

describe("notifyBackInStock", () => {
  it("emails everyone waiting once the variant can be bought again", async () => {
    await ask("a@b.co");
    await ask("c@d.co");
    expect(await notifyBackInStock(shop, product(0), now)).toBe(0);
    expect(db.message.rows).toHaveLength(0);

    expect(await notifyBackInStock(shop, product(3), now)).toBe(2);
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
          buttonUrl: "https://tom.myshopify.com/products/blue-shirt?variant=501",
        },
      },
    });
    expect(db.stockAlert.rows.map((r) => r.status)).toEqual(["notified", "notified"]);

    // একই webhook আবার এলে দ্বিতীয়বার যায় না
    expect(await notifyBackInStock(shop, product(3), now)).toBe(0);
    expect(db.message.rows).toHaveLength(2);
  });

  it("keeps people waiting while the tool is off", async () => {
    await ask("a@b.co");
    db.toolSetting.rows[0]!.enabled = false;
    expect(await notifyBackInStock(shop, product(3), now)).toBe(0);
    expect(db.stockAlert.rows[0]?.status).toBe("waiting");
  });

  it("lets a buyer ask again after being notified, and emails them again", async () => {
    await ask("a@b.co");
    await notifyBackInStock(shop, product(3), now);
    const later = new Date(now.getTime() + 86_400_000);
    expect(
      await requestStockAlert(shop, { productId: "77", variantId: "501", email: "a@b.co" }, later),
    ).toBe("saved");
    expect(await notifyBackInStock(shop, product(1), later)).toBe(1);
    expect(db.message.rows).toHaveLength(2);
  });

  it("leaves the variant name out when the product has no real variants", async () => {
    await ask("a@b.co");
    const single = product(1);
    single.variants[0]!.title = "Default Title";
    await notifyBackInStock(shop, single, now);
    expect(db.message.rows[0]?.payload).toMatchObject({ vars: { product: "Blue Shirt" } });
  });
});
