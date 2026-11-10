import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { FLOWS } = await import("./email-template");
const {
  getFlows,
  onOrderCreated,
  onOrderPaid,
  queueWinbacks,
  recordCheckout,
  saveFlow,
  triggerFlow,
} = await import("./flows.server");

const now = new Date("2026-11-10T10:00:00Z");
let shop: { id: string; domain: string; plan: string | null };

function enableTool(settings: Record<string, unknown> = {}) {
  db.toolSetting.seed({ shopId: shop.id, toolId: "email-marketing", enabled: true, settings });
}
function enableFlow(key: string, delayMinutes = FLOWS[key as keyof typeof FLOWS].delayMinutes) {
  db.emailFlow.seed({
    shopId: shop.id,
    key,
    enabled: true,
    delayMinutes,
    content: FLOWS[key as keyof typeof FLOWS].content,
  });
}
const payloadOf = (row: Record<string, unknown>) =>
  row.payload as {
    marketing: boolean;
    allowNonSubscribers: boolean;
    checkoutId?: string;
    vars: Record<string, string>;
    content: Record<string, string>;
  };

beforeEach(() => {
  resetFakeDb();
  const row = db.shop.seed({ domain: "tom.myshopify.com" });
  shop = { id: row.id as string, domain: "tom.myshopify.com", plan: "professional" };
});

describe("flow settings", () => {
  it("shows every flow switched off with default text until the merchant saves", async () => {
    const flows = await getFlows(shop.id);
    expect(flows.map((f) => f.key)).toEqual([
      "welcome",
      "abandoned-checkout",
      "review-request",
      "winback",
    ]);
    expect(flows.every((f) => !f.enabled)).toBe(true);
    expect(flows[0]?.content.subject).toBe("Welcome to {shop}");
  });

  it("keeps the delay inside the allowed range", async () => {
    const content = FLOWS["abandoned-checkout"].content;
    await saveFlow(shop.id, "abandoned-checkout", { enabled: true, delayMinutes: 1, content });
    expect(db.emailFlow.rows[0]).toMatchObject({ enabled: true, delayMinutes: 15 });
    await saveFlow(shop.id, "abandoned-checkout", { enabled: true, delayMinutes: 9e9, content });
    expect(db.emailFlow.rows[0]?.delayMinutes).toBe(7 * 24 * 60);
    await expect(
      saveFlow(shop.id, "nope", { enabled: true, delayMinutes: 5, content }),
    ).rejects.toThrow();
    await expect(
      saveFlow(shop.id, "welcome", { enabled: true, delayMinutes: 5, content: { subject: "" } }),
    ).rejects.toThrow();
  });
});

describe("triggerFlow", () => {
  const input = {
    email: "a@b.com",
    firstName: " Rahim ",
    buttonUrl: "https://tom.com",
    dedupeKey: "k1",
  };

  it("queues nothing while the Email Marketing tool or the flow is off", async () => {
    expect(await triggerFlow(shop, "welcome", input, now)).toBe(false);
    enableTool();
    expect(await triggerFlow(shop, "welcome", input, now)).toBe(false);
    expect(db.message.rows).toHaveLength(0);
  });

  it("queues nothing on the Starter plan even when switched on", async () => {
    enableTool();
    enableFlow("welcome");
    expect(await triggerFlow({ ...shop, plan: "starter" }, "welcome", input, now)).toBe(false);
  });

  it("queues the email after the flow's delay, once per event", async () => {
    enableTool();
    enableFlow("welcome", 5);
    expect(await triggerFlow(shop, "welcome", input, now)).toBe(true);
    expect(await triggerFlow(shop, "welcome", input, now)).toBe(false);
    const [message] = db.message.rows;
    expect(message).toMatchObject({
      kind: "flow",
      refId: "welcome",
      recipient: "a@b.com",
      dedupeKey: "flow:welcome:k1",
    });
    expect((message?.sendAt as Date).getTime()).toBe(now.getTime() + 5 * 60_000);
    const payload = payloadOf(message as Record<string, unknown>);
    expect(payload.vars.first_name).toBe("Rahim");
    expect(payload.content.buttonUrl).toBe("https://tom.com");
    // welcome সবসময় শুধু গ্রাহকদের জন্য
    expect(payload.allowNonSubscribers).toBe(false);
  });

  it("falls back to a neutral greeting without a name", async () => {
    enableTool();
    enableFlow("welcome");
    await triggerFlow(shop, "welcome", { ...input, firstName: null }, now);
    expect(payloadOf(db.message.rows[0] as Record<string, unknown>).vars.first_name).toBe("there");
  });
});

describe("abandoned checkout", () => {
  const checkout = {
    token: "tok1",
    email: " Buyer@Example.com ",
    abandoned_checkout_url: "https://tom.com/checkouts/tok1/recover",
    total_price: "49.00",
    currency: "BDT",
    shipping_address: { first_name: "Mina" },
  };

  it("stores nothing about the shopper while the flow is off", async () => {
    enableTool();
    await recordCheckout(shop, checkout);
    expect(db.abandonedCheckout.rows).toHaveLength(0);
    expect(db.message.rows).toHaveLength(0);
  });

  it("queues one recovery email per checkout, however many updates arrive", async () => {
    enableTool();
    enableFlow("abandoned-checkout", 60);
    await recordCheckout(shop, checkout);
    await recordCheckout(shop, { ...checkout, total_price: "59.00" });
    expect(db.abandonedCheckout.rows).toHaveLength(1);
    expect(db.abandonedCheckout.rows[0]).toMatchObject({
      email: "buyer@example.com",
      total: "59.00",
    });
    expect(db.message.rows).toHaveLength(1);
    const payload = payloadOf(db.message.rows[0] as Record<string, unknown>);
    expect(payload.content.buttonUrl).toBe("https://tom.com/checkouts/tok1/recover");
    expect(payload.checkoutId).toBe(db.abandonedCheckout.rows[0]?.id);
    expect(payload.vars.first_name).toBe("Mina");
  });

  it("by default only emails shoppers who agreed to marketing", async () => {
    enableTool({ subscribersOnly: true });
    enableFlow("abandoned-checkout");
    await recordCheckout(shop, checkout);
    await recordCheckout(shop, { ...checkout, token: "tok2", buyer_accepts_marketing: true });
    const [first, second] = db.message.rows.map((r) => payloadOf(r as Record<string, unknown>));
    expect(first?.allowNonSubscribers).toBe(false);
    expect(second?.allowNonSubscribers).toBe(true);
  });

  it("emails every shopper when the merchant turned 'subscribers only' off", async () => {
    enableTool({ subscribersOnly: false });
    enableFlow("abandoned-checkout");
    await recordCheckout(shop, checkout);
    expect(payloadOf(db.message.rows[0] as Record<string, unknown>).allowNonSubscribers).toBe(true);
  });

  it("ignores checkouts without an email, a token or a safe recovery link", async () => {
    enableTool();
    enableFlow("abandoned-checkout");
    await recordCheckout(shop, { ...checkout, email: null });
    await recordCheckout(shop, { ...checkout, token: undefined });
    await recordCheckout(shop, { ...checkout, abandoned_checkout_url: "http://tom.com/x" });
    expect(db.abandonedCheckout.rows).toHaveLength(0);
  });

  it("does not email a completed checkout", async () => {
    enableTool();
    enableFlow("abandoned-checkout");
    await recordCheckout(shop, { ...checkout, completed_at: "2026-11-10T09:00:00Z" });
    expect(db.abandonedCheckout.rows[0]?.completedAt).toBeInstanceOf(Date);
    expect(db.message.rows).toHaveLength(0);
  });

  it("marks the checkout, and the shopper's other open checkouts, done when an order arrives", async () => {
    db.abandonedCheckout.seed({ shopId: shop.id, token: "tok1", email: "buyer@example.com" });
    db.abandonedCheckout.seed({ shopId: shop.id, token: "tok2", email: "buyer@example.com" });
    db.abandonedCheckout.seed({ shopId: shop.id, token: "tok3", email: "other@example.com" });
    db.subscriber.seed({ shopId: shop.id, email: "buyer@example.com" });
    await onOrderCreated(shop.id, { checkout_token: "tok1", email: "Buyer@example.com" }, now);
    expect(db.abandonedCheckout.rows.map((r) => r.completedAt)).toEqual([now, now, null]);
    expect(db.subscriber.rows[0]?.lastOrderAt).toEqual(now);
  });
});

describe("review request", () => {
  const admin = {
    graphql: vi.fn(async () =>
      Response.json({ data: { product: { handle: "blue-tee", title: "Blue Tee" } } }),
    ),
  };
  const order = {
    id: 5001,
    name: "#1001",
    email: "a@b.com",
    customer: { first_name: "Rahim" },
    line_items: [
      { product_id: null, title: "Tip" },
      { product_id: 77, title: "Blue Tee" },
    ],
  };

  beforeEach(() => admin.graphql.mockClear());

  it("does not call Shopify at all while the flow is off", async () => {
    enableTool();
    await onOrderPaid(shop, admin, order);
    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("links to the first real product's review section, once per order", async () => {
    enableTool({ subscribersOnly: false });
    enableFlow("review-request");
    await onOrderPaid(shop, admin, order);
    await onOrderPaid(shop, admin, order);
    expect(db.message.rows).toHaveLength(1);
    const payload = payloadOf(db.message.rows[0] as Record<string, unknown>);
    expect(payload.content.buttonUrl).toBe(
      "https://tom.myshopify.com/products/blue-tee#app-reviews",
    );
    expect(payload.vars).toMatchObject({
      product: "Blue Tee",
      order: "#1001",
      first_name: "Rahim",
    });
    expect(db.message.rows[0]?.dedupeKey).toBe("flow:review-request:5001");
  });
});

describe("win-back", () => {
  it("emails subscribers whose last order was exactly the chosen number of days ago", async () => {
    enableTool();
    enableFlow("winback", 60 * 24 * 60);
    const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
    db.subscriber.seed({ shopId: shop.id, email: "due@b.com", lastOrderAt: daysAgo(60.5) });
    db.subscriber.seed({ shopId: shop.id, email: "recent@b.com", lastOrderAt: daysAgo(10) });
    db.subscriber.seed({ shopId: shop.id, email: "old@b.com", lastOrderAt: daysAgo(90) });
    db.subscriber.seed({ shopId: shop.id, email: "never@b.com" });
    db.subscriber.seed({
      shopId: shop.id,
      email: "gone@b.com",
      status: "unsubscribed",
      lastOrderAt: daysAgo(60.5),
    });

    expect(await queueWinbacks(now)).toBe(1);
    expect(db.message.rows.map((r) => r.recipient)).toEqual(["due@b.com"]);
    // দেরি আগেই পেরিয়ে গেছে, তাই এখনই পাঠানোর সময়
    expect((db.message.rows[0]?.sendAt as Date).getTime()).toBe(now.getTime());
    // আবার স্ক্যান চললেও দ্বিতীয়বার যায় না
    expect(await queueWinbacks(new Date(now.getTime() + 3_600_000))).toBe(0);
  });

  it("skips uninstalled shops", async () => {
    enableTool();
    enableFlow("winback", 60 * 24 * 60);
    db.shop.rows[0]!.uninstalledAt = now;
    db.subscriber.seed({
      shopId: shop.id,
      email: "due@b.com",
      lastOrderAt: new Date(now.getTime() - 60.5 * 86_400_000),
    });
    expect(await queueWinbacks(now)).toBe(0);
  });
});
