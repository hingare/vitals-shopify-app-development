import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { FLOWS } = await import("./email-template");
const { findCustomerId } = await import("./shopify-customers.server");
const {
  applyCustomerEvent,
  forgetStaleSubscribers,
  importPage,
  listSubscribers,
  parseCustomerPayload,
  pushConsent,
  queueReimport,
  subscribe,
  subscriberCounts,
  unsubscribe,
} = await import("./subscribers.server");

let shop: { id: string; domain: string; plan: string | null };
const jobs = () => db.job.rows.map((j) => [j.kind, j.payload] as const);

/** নকল Admin API: দেওয়া উত্তরগুলো পরপর ফেরত দেয় */
const admin = (responses: unknown[]) => {
  const graphql = vi.fn<
    (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>
  >(async () => Response.json({ data: responses.shift() }));
  return { graphql };
};

beforeEach(() => {
  resetFakeDb();
  const row = db.shop.seed({ domain: "tom.myshopify.com" });
  shop = { id: row.id as string, domain: "tom.myshopify.com", plan: "professional" };
});

describe("subscribe", () => {
  it("adds the shopper, tells Shopify and the connected email tools, and queues the welcome email", async () => {
    db.integration.seed({ shopId: shop.id, provider: "klaviyo", secret: "x" });
    db.toolSetting.seed({ shopId: shop.id, toolId: "email-marketing", enabled: true });
    db.emailFlow.seed({
      shopId: shop.id,
      key: "welcome",
      enabled: true,
      delayMinutes: 5,
      content: FLOWS.welcome.content,
    });

    const result = await subscribe(shop, {
      email: " Rahim@Example.com ",
      source: "spin-wheel",
      firstName: "Rahim",
    });
    expect(result).toBe("created");
    expect(db.subscriber.rows[0]).toMatchObject({
      email: "rahim@example.com",
      status: "subscribed",
      source: "spin-wheel",
      firstName: "Rahim",
    });
    expect(jobs()).toEqual([
      [
        "shopify-consent",
        {
          email: "rahim@example.com",
          firstName: "Rahim",
          state: "SUBSCRIBED",
          source: "spin-wheel",
        },
      ],
      [
        "esp-sync",
        {
          provider: "klaviyo",
          action: "subscribe",
          contact: { email: "rahim@example.com", source: "spin-wheel", firstName: "Rahim" },
        },
      ],
    ]);
    expect(db.message.rows[0]).toMatchObject({
      kind: "flow",
      refId: "welcome",
      recipient: "rahim@example.com",
    });
  });

  it("does nothing new for someone already subscribed, but fills in a missing name", async () => {
    db.subscriber.seed({ shopId: shop.id, email: "a@b.com" });
    expect(await subscribe(shop, { email: "a@b.com", source: "popup", firstName: "Mina" })).toBe(
      "exists",
    );
    expect(db.subscriber.rows[0]).toMatchObject({ firstName: "Mina", source: "shopify" });
    expect(db.job.rows).toHaveLength(0);
    expect(db.message.rows).toHaveLength(0);
  });

  it("does not write back to Shopify when the news came from Shopify", async () => {
    await subscribe(shop, { email: "a@b.com", source: "shopify", fromShopify: true });
    expect(db.job.rows).toHaveLength(0);
  });

  it("lets someone who unsubscribed opt in again", async () => {
    db.subscriber.seed({
      shopId: shop.id,
      email: "a@b.com",
      status: "unsubscribed",
      unsubscribedAt: new Date(),
    });
    expect(await subscribe(shop, { email: "a@b.com", source: "popup" })).toBe("resubscribed");
    expect(db.subscriber.rows[0]).toMatchObject({ status: "subscribed", unsubscribedAt: null });
  });

  it("ignores a late copy of an old opt-in from Shopify once the shopper has unsubscribed", async () => {
    // Shopify একই খবর আবার পাঠাতে পারে; এর মধ্যে তিনি আমাদের ইমেইলের লিংক থেকে আনসাবস্ক্রাইব করেছেন
    db.subscriber.seed({
      shopId: shop.id,
      email: "a@b.com",
      status: "unsubscribed",
      unsubscribedAt: new Date("2026-11-10T11:00:00Z"),
    });
    const old = { email: "a@b.com", source: "shopify", fromShopify: true };
    expect(await subscribe(shop, { ...old, at: new Date("2026-11-10T10:00:00Z") })).toBe("stale");
    expect(await subscribe(shop, { ...old, at: new Date("2026-11-10T11:00:00Z") })).toBe("stale");
    expect(db.subscriber.rows[0]?.status).toBe("unsubscribed");
    expect(db.message.rows).toHaveLength(0);

    // পরে Shopify-তে আবার রাজি হলে সেটা মানা হয়, Shopify-র সময়সহ
    const again = new Date("2026-11-10T12:00:00Z");
    expect(await subscribe(shop, { ...old, at: again })).toBe("resubscribed");
    expect(db.subscriber.rows[0]).toMatchObject({
      status: "subscribed",
      consentAt: again,
      unsubscribedAt: null,
    });
  });

  it("keeps Shopify's own time of consent, and never one from the future", async () => {
    const at = new Date("2026-11-01T08:00:00Z");
    await subscribe(shop, { email: "a@b.com", source: "shopify", fromShopify: true, at });
    expect(db.subscriber.rows[0]?.consentAt).toEqual(at);

    // আগে থেকে থাকা গ্রাহকের নতুন সম্মতির সময়ও রাখা হয় (তার আগের আনসাবস্ক্রাইবের খবর তখন পুরনো)
    const newer = new Date("2026-11-05T08:00:00Z");
    await subscribe(shop, { email: "a@b.com", source: "shopify", fromShopify: true, at: newer });
    expect(db.subscriber.rows[0]?.consentAt).toEqual(newer);
    await subscribe(shop, { email: "a@b.com", source: "shopify", fromShopify: true, at });
    expect(db.subscriber.rows[0]?.consentAt).toEqual(newer);

    const before = Date.now();
    await subscribe(shop, {
      email: "late@b.com",
      source: "shopify",
      fromShopify: true,
      at: new Date(before + 86_400_000),
    });
    const stored = (db.subscriber.rows[1]?.consentAt as Date).getTime();
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(Date.now());
  });

  it("never re-adds an address that bounced or complained", async () => {
    db.subscriber.seed({ shopId: shop.id, email: "a@b.com", status: "complained" });
    expect(await subscribe(shop, { email: "a@b.com", source: "popup" })).toBe("suppressed");
    expect(db.subscriber.rows[0]?.status).toBe("complained");
    expect(db.job.rows).toHaveLength(0);
  });

  it("rejects a bad email address", async () => {
    expect(await subscribe(shop, { email: "not an email", source: "popup" })).toBe("invalid");
    expect(await subscribe(shop, { email: undefined, source: "popup" })).toBe("invalid");
    expect(db.subscriber.rows).toHaveLength(0);
  });
});

describe("unsubscribe", () => {
  it("stops the emails and tells Shopify and the connected email tools", async () => {
    db.integration.seed({ shopId: shop.id, provider: "mailchimp", secret: "x" });
    db.subscriber.seed({ shopId: shop.id, email: "a@b.com", source: "popup" });
    expect(await unsubscribe(shop.id, "A@b.com")).toBe(true);
    expect(db.subscriber.rows[0]).toMatchObject({ status: "unsubscribed" });
    expect(db.subscriber.rows[0]?.unsubscribedAt).toBeInstanceOf(Date);
    expect(jobs()).toEqual([
      ["shopify-consent", { email: "a@b.com", state: "UNSUBSCRIBED" }],
      [
        "esp-sync",
        { provider: "mailchimp", action: "unsubscribe", email: "a@b.com", source: "popup" },
      ],
    ]);
  });

  it("remembers an address that was never on the list, so no email reaches it later", async () => {
    expect(await unsubscribe(shop.id, "stranger@b.com")).toBe(true);
    expect(db.subscriber.rows[0]).toMatchObject({
      email: "stranger@b.com",
      status: "unsubscribed",
    });
  });

  it("is a no-op the second time, so the two systems cannot ping-pong", async () => {
    db.subscriber.seed({ shopId: shop.id, email: "a@b.com" });
    await unsubscribe(shop.id, "a@b.com", { fromShopify: true });
    expect(db.job.rows).toHaveLength(0);
    expect(await unsubscribe(shop.id, "a@b.com")).toBe(false);
    expect(db.job.rows).toHaveLength(0);
  });

  it("keeps Shopify's own time of the unsubscribe", async () => {
    db.subscriber.seed({
      shopId: shop.id,
      email: "a@b.com",
      consentAt: new Date("2026-11-01T10:00:00Z"),
    });
    const at = new Date("2026-11-09T10:00:00Z");
    expect(await unsubscribe(shop.id, "a@b.com", { fromShopify: true, at })).toBe(true);
    expect(db.subscriber.rows[0]).toMatchObject({ status: "unsubscribed", unsubscribedAt: at });
  });

  it("ignores stale news from Shopify that is older than a fresh opt-in here", async () => {
    const consentAt = new Date("2026-11-10T10:00:00Z");
    db.subscriber.seed({ shopId: shop.id, email: "a@b.com", consentAt });
    const stale = new Date("2026-11-09T10:00:00Z");
    expect(await unsubscribe(shop.id, "a@b.com", { fromShopify: true, at: stale })).toBe(false);
    expect(db.subscriber.rows[0]?.status).toBe("subscribed");
  });
});

describe("Shopify customer webhooks", () => {
  /** স্টোরে Email Marketing চালু: গ্রাহক তালিকা কাজে লাগে */
  const useList = () =>
    db.toolSetting.seed({ shopId: shop.id, toolId: "email-marketing", enabled: true });
  /** Shopify-র উত্তর: এই customer-এর নাম, ট্যাগ আর সম্মতির এখনকার অবস্থা */
  const customer = (extra: Record<string, unknown> = {}) => ({
    customer: {
      firstName: "Mina",
      tags: ["newsletter", "Popup"],
      defaultEmailAddress: {
        emailAddress: "A@b.com",
        marketingState: "SUBSCRIBED",
        marketingUpdatedAt: "2026-11-10T09:00:00Z",
      },
      ...extra,
    },
  });
  const consent = (state: string, at: string | null = "2026-11-10T09:00:00Z") => ({
    email: "a@b.com",
    customerId: "9",
    state,
    at: at ? new Date(at) : null,
  });
  const created = { email: "a@b.com", customerId: "9", state: null, at: null };

  it("reads customers/create, which carries no consent", () => {
    expect(parseCustomerPayload({ id: 123, email: "A@B.com" })).toEqual({
      email: "a@b.com",
      customerId: "123",
      state: null,
      at: null,
    });
  });

  it("reads customers_email_marketing_consent/update", () => {
    expect(
      parseCustomerPayload({
        customer_id: 706405506930370084n.toString(),
        email_address: "Bob@Biller.com",
        email_marketing_consent: {
          state: "subscribed",
          consent_updated_at: "2026-11-10T09:00:00Z",
        },
      }),
    ).toEqual({
      email: "bob@biller.com",
      customerId: "706405506930370084",
      state: "subscribed",
      at: new Date("2026-11-10T09:00:00Z"),
    });
    expect(
      parseCustomerPayload({
        customer_id: 9,
        email_address: "a@b.com",
        email_marketing_consent: { state: "not_subscribed", consent_updated_at: null },
      }),
    ).toMatchObject({ customerId: "9", state: "not_subscribed", at: null });
  });

  it("ignores a payload without an email (redacted fields) and drops an id that is not a number", () => {
    expect(parseCustomerPayload({ id: 1, email: null })).toBeNull();
    expect(parseCustomerPayload({ customer_id: 1 })).toBeNull();
    expect(parseCustomerPayload({ id: "gid://x/1", email: "a@b.com" })?.customerId).toBeNull();
    // এত বড় সংখ্যা JSON থেকে হুবহু পড়া যায় না; ভুল id দিয়ে অন্য customer-কে ধরা হয় না
    expect(parseCustomerPayload({ id: 2 ** 60, email: "a@b.com" })?.customerId).toBeNull();
  });

  it("adds a new subscriber from the consent news, with the name and source Shopify knows", async () => {
    useList();
    const client = admin([customer()]);
    expect(await applyCustomerEvent(shop, consent("subscribed"), client)).toBe("created");
    expect(client.graphql.mock.calls[0]?.[1]?.variables).toEqual({
      id: "gid://shopify/Customer/9",
    });
    expect(db.subscriber.rows[0]).toMatchObject({
      email: "a@b.com",
      status: "subscribed",
      customerId: "9",
      firstName: "Mina",
      // আমাদের Pop-up ফর্ম "popup" ট্যাগ দেয়
      source: "popup",
      consentAt: new Date("2026-11-10T09:00:00Z"),
    });
    // Shopify থেকে আসা খবর আবার Shopify-তে লেখা হয় না
    expect(db.job.rows.filter((j) => j.kind === "shopify-consent")).toHaveLength(0);
  });

  it("still adds the subscriber when Shopify does not answer, just without the name", async () => {
    useList();
    const failing = { graphql: vi.fn(async () => Response.json({ errors: [{ message: "No" }] })) };
    expect(await applyCustomerEvent(shop, consent("subscribed"), failing)).toBe("created");
    expect(db.subscriber.rows[0]).toMatchObject({ firstName: null, source: "shopify" });
    // admin ছাড়াও (স্টোরের সেশন না থাকলে) একই
    db.subscriber.rows.length = 0;
    expect(await applyCustomerEvent(shop, consent("subscribed"))).toBe("created");
  });

  it("does not keep Shopify's webhook waiting when the answer is slow", async () => {
    useList();
    vi.useFakeTimers();
    try {
      const silent = { graphql: vi.fn(() => new Promise<Response>(() => {})) };
      const result = applyCustomerEvent(shop, consent("subscribed"), silent);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await result).toBe("created");
      expect(db.subscriber.rows[0]).toMatchObject({ firstName: null, source: "shopify" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks Shopify about a new customer, and adds them only if they agreed with that address", async () => {
    useList();
    expect(await applyCustomerEvent(shop, created, admin([customer()]))).toBe("created");
    expect(db.subscriber.rows[0]).toMatchObject({
      email: "a@b.com",
      customerId: "9",
      firstName: "Mina",
      source: "popup",
      consentAt: new Date("2026-11-10T09:00:00Z"),
    });

    db.subscriber.rows.length = 0;
    const address = (extra: Record<string, unknown>) => ({
      defaultEmailAddress: {
        emailAddress: "a@b.com",
        marketingState: "SUBSCRIBED",
        marketingUpdatedAt: null,
        ...extra,
      },
    });
    const answers = [
      customer(address({ marketingState: "NOT_SUBSCRIBED" })),
      customer(address({ marketingState: "PENDING" })),
      // এর মধ্যে ঠিকানা বদলে গেছে: অন্য ঠিকানার সম্মতি এই ঠিকানায় খাটে না
      customer(address({ emailAddress: "other@b.com" })),
      customer({ defaultEmailAddress: null }),
      { customer: null },
    ];
    for (const answer of answers) {
      expect(await applyCustomerEvent(shop, created, admin([answer]))).toBeNull();
    }
    // জিজ্ঞেস করার উপায় না থাকলে না জেনে কাউকে যোগ করা হয় না
    expect(await applyCustomerEvent(shop, created)).toBeNull();
    expect(await applyCustomerEvent(shop, { ...created, customerId: null }, admin([]))).toBeNull();
    expect(db.subscriber.rows).toHaveLength(0);
  });

  it("fails the webhook when Shopify cannot say whether a new customer agreed, so it is sent again", async () => {
    useList();
    const failing = { graphql: vi.fn(async () => Response.json({ errors: [{ message: "No" }] })) };
    await expect(applyCustomerEvent(shop, created, failing)).rejects.toThrow("No");
    expect(db.subscriber.rows).toHaveLength(0);
    // পরের বার Shopify উত্তর দিলে তিনি যোগ হন
    expect(await applyCustomerEvent(shop, created, admin([customer()]))).toBe("created");
  });

  it("does not ask Shopify about someone already on the list, and fills in their customer id", async () => {
    // যেমন Spin the Wheel থেকে আসা গ্রাহক: Shopify-তে customer তৈরি হলে তার খবর ফিরে আসে
    db.subscriber.seed({ shopId: shop.id, email: "a@b.com", source: "spin-wheel" });
    const client = admin([]);
    expect(await applyCustomerEvent(shop, created, client)).toBe("exists");
    expect(await applyCustomerEvent(shop, consent("subscribed"), client)).toBe("exists");
    expect(client.graphql).not.toHaveBeenCalled();
    expect(db.subscriber.rows[0]).toMatchObject({ customerId: "9", source: "spin-wheel" });
    expect(db.job.rows).toHaveLength(0);
    expect(db.message.rows).toHaveLength(0);
  });

  it("mirrors an unsubscribe, and leaves the other states alone", async () => {
    db.subscriber.seed({
      shopId: shop.id,
      email: "a@b.com",
      consentAt: new Date("2026-11-01T00:00:00Z"),
    });
    const client = admin([]);
    await applyCustomerEvent(shop, consent("not_subscribed", null), client);
    await applyCustomerEvent(shop, consent("pending"), client);
    await applyCustomerEvent(shop, consent("invalid"), client);
    expect(db.subscriber.rows[0]?.status).toBe("subscribed");
    await applyCustomerEvent(shop, consent("unsubscribed"), client);
    expect(db.subscriber.rows[0]).toMatchObject({
      status: "unsubscribed",
      unsubscribedAt: new Date("2026-11-10T09:00:00Z"),
    });
    expect(client.graphql).not.toHaveBeenCalled();
    expect(db.job.rows.filter((j) => j.kind === "shopify-consent")).toHaveLength(0);
  });

  it("lets Shopify's newer opt-in bring back someone who unsubscribed, but not an older one", async () => {
    useList();
    db.subscriber.seed({
      shopId: shop.id,
      email: "a@b.com",
      status: "unsubscribed",
      unsubscribedAt: new Date("2026-11-10T08:00:00Z"),
    });
    const client = admin([]);
    expect(
      await applyCustomerEvent(shop, consent("subscribed", "2026-11-10T07:00:00Z"), client),
    ).toBe("stale");
    expect(await applyCustomerEvent(shop, consent("subscribed"), client)).toBe("resubscribed");
    expect(client.graphql).not.toHaveBeenCalled();

    // নতুন customer-এর খবরে সম্মতি নেই, তাই Shopify-র উত্তর আর তার সময় দেখা হয়
    db.subscriber.rows[0]!.status = "unsubscribed";
    db.subscriber.rows[0]!.unsubscribedAt = new Date("2026-11-10T10:00:00Z");
    expect(await applyCustomerEvent(shop, created, admin([customer()]))).toBe("stale");
    db.subscriber.rows[0]!.unsubscribedAt = new Date("2026-11-10T08:00:00Z");
    expect(await applyCustomerEvent(shop, created, admin([customer()]))).toBe("resubscribed");
  });

  it("never brings back an address that bounced or complained", async () => {
    useList();
    db.subscriber.seed({ shopId: shop.id, email: "a@b.com", status: "bounced" });
    expect(await applyCustomerEvent(shop, consent("subscribed"), admin([]))).toBe("suppressed");
    expect(await applyCustomerEvent(shop, created, admin([]))).toBe("suppressed");
    expect(db.subscriber.rows[0]?.status).toBe("bounced");
  });

  it("stores nothing about Shopify's customers for a store that does not use the list", async () => {
    // Email Marketing বন্ধ, কোনো ইমেইল টুলও যুক্ত নয়: ক্রেতার ঠিকানা জমানোর কারণ নেই
    const client = admin([]);
    expect(await applyCustomerEvent(shop, consent("subscribed"), client)).toBeNull();
    expect(await applyCustomerEvent(shop, created, client)).toBeNull();
    await applyCustomerEvent(shop, consent("unsubscribed"), client);
    expect(db.subscriber.rows).toHaveLength(0);
    expect(client.graphql).not.toHaveBeenCalled();

    // Starter প্ল্যানে Email Marketing নেই, তাই টুলের সারি চালু থাকলেও একই
    useList();
    shop = { ...shop, plan: "starter" };
    expect(await applyCustomerEvent(shop, consent("subscribed"), client)).toBeNull();
    expect(db.subscriber.rows).toHaveLength(0);
  });

  it("keeps the list for a store that has an email tool connected, and remembers a stranger's unsubscribe", async () => {
    db.integration.seed({ shopId: shop.id, provider: "klaviyo", secret: "x" });
    await applyCustomerEvent(shop, { ...consent("unsubscribed"), email: "gone@b.com" }, admin([]));
    expect(db.subscriber.rows[0]).toMatchObject({ email: "gone@b.com", status: "unsubscribed" });

    expect(await applyCustomerEvent(shop, consent("subscribed"), admin([customer()]))).toBe(
      "created",
    );
    expect(jobs()).toContainEqual([
      "esp-sync",
      {
        provider: "klaviyo",
        action: "subscribe",
        contact: { email: "a@b.com", source: "popup", firstName: "Mina" },
      },
    ]);
  });
});

describe("writing consent to Shopify", () => {
  it("creates the customer with consent when Shopify does not know the email", async () => {
    db.subscriber.seed({ shopId: shop.id, email: "a@b.com" });
    const client = admin([
      { customers: { nodes: [] } },
      { customerCreate: { customer: { id: "gid://shopify/Customer/77" }, userErrors: [] } },
    ]);
    await pushConsent(client, shop.id, {
      email: "a@b.com",
      firstName: "Mina",
      state: "SUBSCRIBED",
      source: "spin-wheel",
    });
    const input = client.graphql.mock.calls[1]?.[1]?.variables?.input as Record<string, unknown>;
    expect(input).toMatchObject({
      email: "a@b.com",
      firstName: "Mina",
      tags: ["newsletter", "spin-wheel"],
      emailMarketingConsent: { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN" },
    });
    expect(db.subscriber.rows[0]?.customerId).toBe("77");
  });

  it("updates consent on an existing customer only when it differs", async () => {
    const same = admin([
      {
        customers: {
          nodes: [
            {
              id: "gid://shopify/Customer/5",
              defaultEmailAddress: { emailAddress: "a@b.com", marketingState: "SUBSCRIBED" },
            },
          ],
        },
      },
    ]);
    await pushConsent(same, shop.id, { email: "a@b.com", state: "SUBSCRIBED" });
    expect(same.graphql).toHaveBeenCalledTimes(1);

    const differs = admin([
      {
        customers: {
          nodes: [
            {
              id: "gid://shopify/Customer/5",
              defaultEmailAddress: { emailAddress: "a@b.com", marketingState: "SUBSCRIBED" },
            },
          ],
        },
      },
      { customerEmailMarketingConsentUpdate: { userErrors: [] } },
    ]);
    await pushConsent(differs, shop.id, { email: "a@b.com", state: "UNSUBSCRIBED" });
    expect(differs.graphql.mock.calls[1]?.[1]?.variables?.input).toMatchObject({
      customerId: "gid://shopify/Customer/5",
      emailMarketingConsent: { marketingState: "UNSUBSCRIBED" },
    });
  });

  it("does not create a customer just to unsubscribe them", async () => {
    const client = admin([{ customers: { nodes: [] } }]);
    await pushConsent(client, shop.id, { email: "a@b.com", state: "UNSUBSCRIBED" });
    expect(client.graphql).toHaveBeenCalledTimes(1);
  });

  it("quotes the email in the search so it cannot change the query", async () => {
    const client = admin([{ customers: { nodes: [] } }]);
    await pushConsent(client, shop.id, { email: 'a"b@c.com', state: "UNSUBSCRIBED" });
    expect(client.graphql.mock.calls[0]?.[1]?.variables?.query).toBe('email:"ab@c.com"');
  });

  it("throws on a Shopify error so the job is retried", async () => {
    const client = admin([
      { customers: { nodes: [] } },
      { customerCreate: { customer: null, userErrors: [{ message: "Email is invalid" }] } },
    ]);
    await expect(
      pushConsent(client, shop.id, { email: "a@b.com", state: "SUBSCRIBED" }),
    ).rejects.toThrow("Email is invalid");
  });

  it("never acts on a customer whose email only resembles the one searched for", async () => {
    const lookalike = {
      customers: {
        nodes: [
          {
            id: "gid://shopify/Customer/9",
            defaultEmailAddress: { emailAddress: "a@b.com.au", marketingState: "SUBSCRIBED" },
          },
        ],
      },
    };
    // সম্মতি বন্ধ করার খবর: কাছাকাছি ঠিকানার অন্য মানুষের সম্মতি বদলায় না
    const client = admin([structuredClone(lookalike)]);
    await pushConsent(client, shop.id, { email: "a@b.com", state: "UNSUBSCRIBED" });
    expect(client.graphql).toHaveBeenCalledTimes(1);
    expect(await findCustomerId(admin([structuredClone(lookalike)]), "a@b.com")).toBeNull();
  });

  it("finds the Shopify id of the customer with exactly that email", async () => {
    const client = admin([
      {
        customers: {
          nodes: [
            {
              id: "gid://shopify/Customer/9",
              defaultEmailAddress: { emailAddress: "a@b.com.au", marketingState: "SUBSCRIBED" },
            },
            {
              id: "gid://shopify/Customer/12",
              defaultEmailAddress: { emailAddress: "A@B.com", marketingState: "NOT_SUBSCRIBED" },
            },
          ],
        },
      },
    ]);
    expect(await findCustomerId(client, " a@b.com ")).toBe("12");
    expect(client.graphql.mock.calls[0]?.[1]?.variables?.query).toBe('email:"a@b.com"');
    expect(await findCustomerId(admin([{ customers: { nodes: [] } }]), "a@b.com")).toBeNull();
  });
});

describe("importing existing subscribers from Shopify", () => {
  it("adds subscribed customers quietly and never changes people already on the list", async () => {
    db.subscriber.seed({ shopId: shop.id, email: "gone@b.com", status: "unsubscribed" });
    const node = (email: string, marketingState = "SUBSCRIBED") => ({
      id: `gid://shopify/Customer/${email.length}`,
      firstName: "X",
      defaultEmailAddress: {
        emailAddress: email,
        marketingState,
        marketingUpdatedAt: "2026-09-01T00:00:00Z",
      },
      lastOrder: { createdAt: "2026-10-01T00:00:00Z" },
    });
    const client = {
      graphql: vi.fn(async () =>
        Response.json({
          data: {
            customers: {
              nodes: [
                node("New@b.com"),
                node("gone@b.com"),
                node("pending@b.com", "PENDING"),
                {
                  id: "gid://shopify/Customer/1",
                  firstName: null,
                  defaultEmailAddress: null,
                  lastOrder: null,
                },
              ],
              pageInfo: { hasNextPage: true, endCursor: "c2" },
            },
          },
        }),
      ),
    };
    expect(await importPage(client, shop.id, null)).toEqual({ added: 1, seen: 4, next: "c2" });
    expect(db.subscriber.rows.map((r) => [r.email, r.status])).toEqual([
      ["gone@b.com", "unsubscribed"],
      ["new@b.com", "subscribed"],
    ]);
    expect(db.subscriber.rows[1]?.lastOrderAt).toEqual(new Date("2026-10-01T00:00:00Z"));
    // সম্মতির সময় Shopify-র হিসাবেই থাকে (আমদানির সময় নয়)
    expect(db.subscriber.rows[1]?.consentAt).toEqual(new Date("2026-09-01T00:00:00Z"));
    // পুরনো গ্রাহক আনার সময় welcome ইমেইল বা সিঙ্ক হয় না
    expect(db.message.rows).toHaveLength(0);
    expect(db.job.rows).toHaveLength(0);
  });
});

describe("after the app is installed again", () => {
  it("forgets who was subscribed, but keeps every opt-out, bounce and complaint", async () => {
    // আনইনস্টল থাকার সময়ে Shopify-তে কে আনসাবস্ক্রাইব করেছেন তা জানার উপায় ছিল না
    for (const [email, status] of [
      ["a@b.com", "subscribed"],
      ["b@b.com", "subscribed"],
      ["gone@b.com", "unsubscribed"],
      ["bad@b.com", "bounced"],
      ["spam@b.com", "complained"],
    ] as const) {
      db.subscriber.seed({ shopId: shop.id, email, status });
    }
    db.subscriber.seed({ shopId: "other", email: "a@b.com" });
    expect(await forgetStaleSubscribers(shop.id)).toBe(2);
    expect(db.subscriber.rows.map((r) => [r.shopId === shop.id, r.email, r.status])).toEqual([
      [true, "gone@b.com", "unsubscribed"],
      [true, "bad@b.com", "bounced"],
      [true, "spam@b.com", "complained"],
      [false, "a@b.com", "subscribed"],
    ]);
  });

  it("brings the list back from Shopify only for a store that uses it", async () => {
    expect(await queueReimport(shop.id)).toBe(false);
    expect(db.job.rows).toHaveLength(0);

    // প্ল্যান তখনো বাছা না থাকলেও চলে (আবার ইনস্টলের ঠিক পরে প্ল্যান থাকে না)
    db.shop.rows[0]!.plan = null;
    db.toolSetting.seed({ shopId: shop.id, toolId: "email-marketing", enabled: true });
    expect(await queueReimport(shop.id)).toBe(true);
    expect(await queueReimport(shop.id)).toBe(true);
    expect(jobs()).toEqual([["subscribers-import", {}]]);

    db.job.rows.length = 0;
    db.toolSetting.rows[0]!.enabled = false;
    expect(await queueReimport(shop.id)).toBe(false);
    db.integration.seed({ shopId: shop.id, provider: "klaviyo", secret: "x" });
    expect(await queueReimport(shop.id)).toBe(true);
    expect(jobs()).toEqual([["subscribers-import", {}]]);
  });
});

describe("admin list", () => {
  it("counts by status and searches by email", async () => {
    db.subscriber.seed({ shopId: shop.id, email: "a@b.com" });
    db.subscriber.seed({ shopId: shop.id, email: "mina@b.com" });
    db.subscriber.seed({ shopId: shop.id, email: "x@b.com", status: "unsubscribed" });
    db.subscriber.seed({ shopId: "other", email: "other@b.com" });
    expect(await subscriberCounts(shop.id)).toEqual({
      subscribed: 2,
      unsubscribed: 1,
      bounced: 0,
      complained: 0,
    });
    const found = await listSubscribers(shop.id, { search: " MINA " });
    expect(found.rows.map((r) => r.email)).toEqual(["mina@b.com"]);
    expect((await listSubscribers(shop.id, { status: "unsubscribed" })).total).toBe(1);
  });
});
