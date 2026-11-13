import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { ensureShop } = await import("./shop.server");

beforeEach(() => resetFakeDb());

describe("ensureShop", () => {
  it("creates the record on first install and leaves an installed shop untouched", async () => {
    const created = await ensureShop("tom.myshopify.com");
    expect(db.shop.rows).toHaveLength(1);
    db.subscriber.seed({ shopId: created.id, email: "a@b.com" });
    const again = await ensureShop("tom.myshopify.com");
    expect(again.id).toBe(created.id);
    expect(db.shop.rows).toHaveLength(1);
    expect(db.subscriber.rows).toHaveLength(1);
    expect(db.job.rows).toHaveLength(0);
  });

  it("after a reinstall, stops trusting the old list and brings it back from Shopify", async () => {
    const shopId = db.shop.seed({
      domain: "tom.myshopify.com",
      plan: null,
      uninstalledAt: new Date("2026-11-10T10:00:00Z"),
    }).id as string;
    db.toolSetting.seed({ shopId, toolId: "email-marketing", enabled: true });
    db.subscriber.seed({ shopId, email: "a@b.com" });
    db.subscriber.seed({ shopId, email: "gone@b.com", status: "unsubscribed" });

    const shop = await ensureShop("tom.myshopify.com");
    expect(shop).toMatchObject({ id: shopId, uninstalledAt: null });
    expect(db.shop.rows[0]?.uninstalledAt).toBeNull();
    // আনইনস্টল থাকার সময়ে কে আনসাবস্ক্রাইব করেছেন জানা নেই: "রাজি" সারি যায়, আনসাবস্ক্রাইব থাকে
    expect(db.subscriber.rows.map((r) => [r.email, r.status])).toEqual([
      ["gone@b.com", "unsubscribed"],
    ]);
    expect(db.job.rows.map((j) => j.kind)).toEqual(["subscribers-import"]);

    // পরের পেজ খোলায় আর কিছু হয় না (এর মধ্যে আনা গ্রাহকেরা থাকেন)
    db.subscriber.seed({ shopId, email: "back@b.com" });
    await ensureShop("tom.myshopify.com");
    expect(db.subscriber.rows).toHaveLength(2);
    expect(db.job.rows).toHaveLength(1);
  });

  it("does not copy Shopify's subscribers for a reinstalled store that never used the list", async () => {
    db.shop.seed({ domain: "tom.myshopify.com", uninstalledAt: new Date() });
    await ensureShop("tom.myshopify.com");
    expect(db.shop.rows[0]?.uninstalledAt).toBeNull();
    expect(db.job.rows).toHaveLength(0);
  });
});
