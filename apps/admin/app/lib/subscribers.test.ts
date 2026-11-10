import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { FLOWS } = await import("./email-template");
const {
  applyConsentChange,
  importPage,
  listSubscribers,
  parseCustomerPayload,
  pushConsent,
  subscribe,
  subscriberCounts,
  unsubscribe,
} = await import("./subscribers.server");

let shop: { id: string; domain: string; plan: string | null };
const jobs = () => db.job.rows.map((j) => [j.kind, j.payload] as const);

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

  it("ignores stale news from Shopify that is older than a fresh opt-in here", async () => {
    const consentAt = new Date("2026-11-10T10:00:00Z");
    db.subscriber.seed({ shopId: shop.id, email: "a@b.com", consentAt });
    const stale = new Date("2026-11-09T10:00:00Z");
    expect(await unsubscribe(shop.id, "a@b.com", { fromShopify: true, at: stale })).toBe(false);
    expect(db.subscriber.rows[0]?.status).toBe("subscribed");
  });
});

describe("Shopify customer webhooks", () => {
  it("reads customers/create and customers/update", () => {
    expect(
      parseCustomerPayload({
        id: 123,
        email: "A@B.com",
        first_name: "Mina",
        phone: "+8801712345678",
        tags: "newsletter, Popup",
        email_marketing_consent: {
          state: "subscribed",
          consent_updated_at: "2026-11-10T09:00:00Z",
        },
      }),
    ).toEqual({
      email: "a@b.com",
      customerId: "123",
      firstName: "Mina",
      phone: "+8801712345678",
      state: "subscribed",
      at: new Date("2026-11-10T09:00:00Z"),
      source: "popup",
    });
  });

  it("reads customers_email_marketing_consent/update", () => {
    expect(
      parseCustomerPayload({
        customer_id: 9,
        email_address: "a@b.com",
        email_marketing_consent: { state: "unsubscribed" },
      }),
    ).toMatchObject({
      email: "a@b.com",
      customerId: "9",
      state: "unsubscribed",
      source: "shopify",
    });
  });

  it("ignores payloads without an email or a consent state (redacted fields)", () => {
    expect(parseCustomerPayload({ id: 1, email: null })).toBeNull();
    expect(parseCustomerPayload({ id: 1, email: "a@b.com" })).toBeNull();
  });

  it("mirrors subscribe and unsubscribe, and leaves other states alone", async () => {
    const base = {
      email: "a@b.com",
      customerId: "9",
      firstName: null,
      phone: null,
      at: null,
      source: "shopify",
    };
    await applyConsentChange(shop, { ...base, state: "subscribed" });
    expect(db.subscriber.rows[0]).toMatchObject({ status: "subscribed", customerId: "9" });
    await applyConsentChange(shop, { ...base, state: "not_subscribed" });
    await applyConsentChange(shop, { ...base, state: "pending" });
    expect(db.subscriber.rows[0]?.status).toBe("subscribed");
    await applyConsentChange(shop, { ...base, state: "unsubscribed" });
    expect(db.subscriber.rows[0]?.status).toBe("unsubscribed");
    // Shopify থেকে আসা খবর আবার Shopify-তে লেখা হয় না
    expect(db.job.rows.filter((j) => j.kind === "shopify-consent")).toHaveLength(0);
  });
});

describe("writing consent to Shopify", () => {
  const admin = (responses: unknown[]) => {
    const graphql = vi.fn<
      (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>
    >(async () => Response.json({ data: responses.shift() }));
    return { graphql };
  };

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
              defaultEmailAddress: { marketingState: "SUBSCRIBED" },
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
              defaultEmailAddress: { marketingState: "SUBSCRIBED" },
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
});

describe("importing existing subscribers from Shopify", () => {
  it("adds subscribed customers quietly and never changes people already on the list", async () => {
    db.subscriber.seed({ shopId: shop.id, email: "gone@b.com", status: "unsubscribed" });
    const node = (email: string, marketingState = "SUBSCRIBED") => ({
      id: `gid://shopify/Customer/${email.length}`,
      firstName: "X",
      defaultEmailAddress: { emailAddress: email, marketingState },
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
    // পুরনো গ্রাহক আনার সময় welcome ইমেইল বা সিঙ্ক হয় না
    expect(db.message.rows).toHaveLength(0);
    expect(db.job.rows).toHaveLength(0);
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
