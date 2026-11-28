import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { ensureShop, isDevelopmentStore, isTestBilling, trialEnd } = await import("./shop.server");

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

describe("trialEnd", () => {
  it("adds the trial days to the subscription start, and is empty without a trial", () => {
    expect(trialEnd({ trialDays: 7, createdAt: "2026-11-01T12:00:00Z" })?.toISOString()).toBe(
      "2026-11-08T12:00:00.000Z",
    );
    expect(trialEnd({ trialDays: 0, createdAt: "2026-11-01T12:00:00Z" })).toBeNull();
    expect(trialEnd({ trialDays: 7, createdAt: "not a date" })).toBeNull();
    expect(trialEnd(undefined)).toBeNull();
  });
});

/** Shopify-র admin.graphql-এর নকল: shop.plan.partnerDevelopment-এর উত্তর দেয়, কয়বার ডাকা হলো গোনে */
function fakeAdmin(answer: boolean | "error" | "missing") {
  const calls: string[] = [];
  const admin = {
    graphql: async (query: string) => {
      calls.push(query);
      if (answer === "error") throw new Error("network");
      const plan = answer === "missing" ? {} : { partnerDevelopment: answer };
      return new Response(JSON.stringify({ data: { shop: { plan } } }));
    },
  };
  return { admin: admin as unknown as Parameters<typeof isDevelopmentStore>[0], calls };
}

describe("test billing on development stores", () => {
  it("asks Shopify once per store and remembers the answer for ten minutes", async () => {
    const { admin, calls } = fakeAdmin(true);
    const start = Date.parse("2026-11-28T10:00:00Z");
    expect(await isDevelopmentStore(admin, "dev-a.myshopify.com", start)).toBe(true);
    expect(await isDevelopmentStore(admin, "dev-a.myshopify.com", start + 9 * 60_000)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("partnerDevelopment");
    expect(await isDevelopmentStore(admin, "dev-a.myshopify.com", start + 11 * 60_000)).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("treats a store as a real one when Shopify can't say, and asks again next time", async () => {
    for (const answer of ["error", "missing"] as const) {
      const { admin, calls } = fakeAdmin(answer);
      const shop = `unknown-${answer}.myshopify.com`;
      expect(await isDevelopmentStore(admin, shop)).toBe(false);
      expect(await isDevelopmentStore(admin, shop)).toBe(false);
      expect(calls).toHaveLength(2);
    }
  });

  it("bills real stores for real in production, and development stores with test charges", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_TEST", "");
    try {
      expect(await isTestBilling(fakeAdmin(false).admin, "real.myshopify.com")).toBe(false);
      expect(await isTestBilling(fakeAdmin(true).admin, "dev-b.myshopify.com")).toBe(true);
      vi.stubEnv("BILLING_TEST", "true");
      const { admin, calls } = fakeAdmin(false);
      expect(await isTestBilling(admin, "staging.myshopify.com")).toBe(true);
      expect(calls).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("always uses test charges outside production", async () => {
    const { admin, calls } = fakeAdmin(false);
    expect(await isTestBilling(admin, "local.myshopify.com")).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
