import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));

const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { activeSlices, makeCode, pickSlice, spin } = await import("./wheel.server");

const now = new Date("2026-11-10T10:00:00Z");
let shop: { id: string; domain: string; plan: string | null };
let sent: Array<Record<string, unknown>>;

/** নকল Admin API: পাঠানো ডিসকাউন্ট জমিয়ে রাখে */
function fakeAdmin(userErrors: Array<{ message: string }> = []) {
  return {
    graphql: vi.fn(async (_query: string, options?: { variables?: Record<string, unknown> }) => {
      sent.push(options?.variables ?? {});
      return new Response(
        JSON.stringify({
          data: {
            discountCodeBasicCreate: {
              codeDiscountNode: userErrors.length
                ? null
                : { id: "gid://shopify/DiscountCodeNode/1" },
              userErrors,
            },
          },
        }),
      );
    }),
  };
}
const deps = (roll: number) => ({ roll: () => roll, code: () => "SPIN-TEST2345" });

beforeEach(() => {
  resetFakeDb();
  sent = [];
  const row = db.shop.seed({ domain: "tom.myshopify.com", plan: "professional" });
  shop = { id: row.id as string, domain: "tom.myshopify.com", plan: "professional" };
  // ডিফল্ট ঘর: 5% (30), No prize (25), 10% (20), No prize (10), 15% (10), 20% (5)
  db.toolSetting.seed({ shopId: shop.id, toolId: "spin-wheel", enabled: true, settings: {} });
});

describe("pickSlice", () => {
  const slices = [
    { n: 1, prize: "A", percentOff: 5, chance: 30 },
    { n: 3, prize: "B", percentOff: 0, chance: 60 },
    { n: 6, prize: "C", percentOff: 20, chance: 10 },
  ];

  it("gives every slice exactly its share of the rolls", () => {
    const counts: Record<number, number> = {};
    for (let roll = 0; roll < 100; roll++) {
      const n = pickSlice(slices, roll).n;
      counts[n] = (counts[n] ?? 0) + 1;
    }
    expect(counts).toEqual({ 1: 30, 3: 60, 6: 10 });
  });

  it("leaves out slices with no chance or no text", () => {
    expect(
      activeSlices({
        slice1: { prize: "A", percentOff: 5, chance: 0 },
        slice2: { prize: "", percentOff: 5, chance: 50 },
        slice3: { prize: "C", percentOff: 0, chance: 50 },
      }).map((s) => s.n),
    ).toEqual([3]);
  });
});

describe("makeCode", () => {
  it("makes codes without look-alike characters", () => {
    for (let i = 0; i < 50; i++) expect(makeCode()).toMatch(/^SPIN-[A-HJKMNP-Z2-9]{8}$/);
  });
});

describe("spin", () => {
  it("creates a single-use discount with a real expiry when the buyer wins", async () => {
    const admin = fakeAdmin();
    const result = await spin(shop, admin, " Rahim@Example.com ", deps(0), now);
    expect(result).toEqual({
      ok: true,
      slice: 1,
      prize: "5% off",
      code: "SPIN-TEST2345",
      expiresAt: "2026-11-13T10:00:00.000Z",
    });
    expect(sent[0]).toEqual({
      discount: {
        title: "Spin the Wheel SPIN-TEST2345",
        code: "SPIN-TEST2345",
        startsAt: "2026-11-10T10:00:00.000Z",
        endsAt: "2026-11-13T10:00:00.000Z",
        usageLimit: 1,
        appliesOncePerCustomer: true,
        context: { all: "ALL" },
        customerGets: { value: { percentage: 0.05 }, items: { all: true } },
      },
    });
    expect(db.wheelSpin.rows[0]).toMatchObject({
      email: "rahim@example.com",
      slice: 1,
      label: "5% off",
      code: "SPIN-TEST2345",
    });
    expect(db.subscriber.rows).toMatchObject([
      { email: "rahim@example.com", source: "spin-wheel", status: "subscribed" },
    ]);
  });

  it("creates no discount on a no-prize slice", async () => {
    const admin = fakeAdmin();
    // 30 থেকে 54 = দ্বিতীয় ঘর ("No prize")
    const result = await spin(shop, admin, "a@b.co", deps(30), now);
    expect(result).toEqual({ ok: true, slice: 2, prize: "No prize", code: null, expiresAt: null });
    expect(admin.graphql).not.toHaveBeenCalled();
    expect(db.wheelSpin.rows).toHaveLength(1);
  });

  it("allows one spin per email until the wait is over", async () => {
    const admin = fakeAdmin();
    await spin(shop, admin, "a@b.co", deps(30), now);
    const again = new Date(now.getTime() + 6 * 86_400_000);
    expect(await spin(shop, admin, "A@B.co", deps(0), again)).toEqual({
      ok: false,
      error: "already",
    });
    const later = new Date(now.getTime() + 8 * 86_400_000);
    expect((await spin(shop, admin, "a@b.co", deps(0), later)).ok).toBe(true);
    expect(db.wheelSpin.rows).toHaveLength(2);
  });

  it("does not count the spin when Shopify refuses the discount", async () => {
    const admin = fakeAdmin([{ message: "Code must be unique" }]);
    expect(await spin(shop, admin, "a@b.co", deps(0), now)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(db.wheelSpin.rows).toHaveLength(0);
    expect(db.subscriber.rows).toHaveLength(0);
  });

  it("refuses bad emails, a disabled tool and a wheel with no slices", async () => {
    const admin = fakeAdmin();
    expect(await spin(shop, admin, "nope", deps(0), now)).toEqual({ ok: false, error: "invalid" });
    const empty = { prize: "x", percentOff: 0, chance: 0 };
    db.toolSetting.rows[0]!.settings = {
      slice1: empty,
      slice2: empty,
      slice3: empty,
      slice4: empty,
      slice5: empty,
      slice6: empty,
    };
    expect(await spin(shop, admin, "a@b.co", deps(0), now)).toEqual({
      ok: false,
      error: "unavailable",
    });
    db.toolSetting.rows[0]!.enabled = false;
    expect(await spin(shop, admin, "a@b.co", deps(0), now)).toEqual({
      ok: false,
      error: "disabled",
    });
  });

  it("tells connected email tools about a win", async () => {
    db.integration.seed({ shopId: shop.id, provider: "klaviyo", secret: "x" });
    await spin(shop, fakeAdmin(), "a@b.co", deps(0), now);
    const events = db.job.rows.filter(
      (job) => (job.payload as { action?: string }).action === "event",
    );
    expect(events).toMatchObject([
      {
        kind: "esp-sync",
        payload: {
          source: "spin-wheel",
          event: {
            email: "a@b.co",
            name: "Spin won",
            properties: { prize: "5% off", code: "SPIN-TEST2345", percentOff: 5 },
          },
        },
      },
    ]);
  });
});
