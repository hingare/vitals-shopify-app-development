import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
// ব্যাকগ্রাউন্ড কাজ স্টোরের Admin API পায় নকলটা থেকে (আসল Shopify লাইব্রেরি চালু করতে হয় না)
vi.mock("./admin-client.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admin-client.server")>()),
  offlineAdmin: async () => client,
}));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { checkStep, consentFix, queueConsentChecks, readState } =
  await import("./consent-check.server");
const { enqueueJob, runJob } = await import("./queue.server");

const NOW = new Date("2026-11-17T03:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
const daysAgo = (days: number) => hoursAgo(days * 24);

let shop: { id: string; domain: string; plan: string | null };

/** নকল Admin API: দেওয়া উত্তরগুলো পরপর ফেরত দেয়, আর কী জিজ্ঞেস করা হলো তা রাখে */
const admin = (responses: unknown[]) => {
  const graphql = vi.fn<
    (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>
  >(async () => Response.json({ data: responses.shift() }));
  return { graphql };
};
const variables = (c: ReturnType<typeof admin>, call: number) =>
  c.graphql.mock.calls[call]?.[1]?.variables;
/** ব্যাকগ্রাউন্ড কাজ যে Admin API পায় */
let client: ReturnType<typeof admin>;

const customer = (id: string, email: string, state: string, at: Date | null) => ({
  id: `gid://shopify/Customer/${id}`,
  defaultEmailAddress: {
    emailAddress: email,
    marketingState: state,
    marketingUpdatedAt: at?.toISOString() ?? null,
  },
});

const fresh = (payload: Record<string, unknown> = {}) => readState(payload, NOW);
const jobs = () => db.job.rows.map((job) => [job.kind, job.payload] as const);
const row = (email: string) => db.subscriber.rows.find((r) => r.email === email);
const add = (data: Record<string, unknown>) => db.subscriber.seed({ shopId: shop.id, ...data });

beforeEach(() => {
  resetFakeDb();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const seeded = db.shop.seed({ domain: "tom.myshopify.com" });
  shop = { id: seeded.id as string, domain: "tom.myshopify.com", plan: "professional" };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("which side wins", () => {
  const local = (
    status: string,
    source: string,
    consentAt: Date,
    unsubscribedAt: Date | null = null,
  ) => ({ status, source, consentAt, unsubscribedAt });
  const remote = (state: string, at: Date | null) => ({ state, at });
  const [t1, t2, t3] = [daysAgo(10), daysAgo(5), daysAgo(1)];
  const none = { action: "none" };

  it("keeps a subscriber Shopify agrees with", () => {
    expect(consentFix(local("subscribed", "shopify", t1), remote("SUBSCRIBED", t1))).toEqual(none);
  });

  it("follows a later unsubscribe in Shopify, keeping Shopify's time", () => {
    expect(consentFix(local("subscribed", "popup", t1), remote("UNSUBSCRIBED", t2))).toEqual({
      action: "unsubscribe",
      at: t2,
    });
  });

  it("lets the unsubscribe win when it is not clear which came last", () => {
    const now = { action: "unsubscribe", at: null };
    expect(consentFix(local("subscribed", "popup", t2), remote("UNSUBSCRIBED", null))).toEqual(now);
    // Shopify-র নিজের গ্রাহক, অথচ Shopify-র আনসাবস্ক্রাইবের সময় আগের: তবুও আনসাবস্ক্রাইব
    expect(consentFix(local("subscribed", "shopify", t2), remote("UNSUBSCRIBED", t1))).toEqual(now);
  });

  it("writes our own opt-in to Shopify again when it never got there", () => {
    const push = { action: "push", state: "SUBSCRIBED" };
    expect(consentFix(local("subscribed", "popup", t2), remote("UNSUBSCRIBED", t1))).toEqual(push);
    expect(
      consentFix(local("subscribed", "spin-wheel", t2), remote("NOT_SUBSCRIBED", null)),
    ).toEqual(push);
  });

  it("leaves a later 'not subscribed' and other states alone, as the webhook does", () => {
    expect(consentFix(local("subscribed", "popup", t1), remote("NOT_SUBSCRIBED", t2))).toEqual(
      none,
    );
    expect(consentFix(local("subscribed", "shopify", t1), remote("NOT_SUBSCRIBED", null))).toEqual(
      none,
    );
    expect(consentFix(local("subscribed", "popup", t1), remote("PENDING", null))).toEqual(none);
  });

  it("brings back someone who opted in again in Shopify after unsubscribing here", () => {
    expect(consentFix(local("unsubscribed", "popup", t1, t2), remote("SUBSCRIBED", t3))).toEqual({
      action: "subscribe",
      at: t3,
    });
  });

  it("writes our unsubscribe to Shopify again while Shopify still has the older opt-in", () => {
    const push = { action: "push", state: "UNSUBSCRIBED" };
    expect(consentFix(local("unsubscribed", "popup", t1, t2), remote("SUBSCRIBED", t1))).toEqual(
      push,
    );
    expect(consentFix(local("unsubscribed", "popup", t1, t2), remote("SUBSCRIBED", null))).toEqual(
      push,
    );
    expect(consentFix(local("complained", "shopify", t1, t2), remote("SUBSCRIBED", t1))).toEqual(
      push,
    );
  });

  it("never brings back a complaint or a bounce, and leaves the shopper's newer opt-in in Shopify", () => {
    expect(consentFix(local("complained", "shopify", t1, t2), remote("SUBSCRIBED", t3))).toEqual(
      none,
    );
    expect(consentFix(local("bounced", "shopify", t1, t2), remote("SUBSCRIBED", t1))).toEqual(none);
    expect(consentFix(local("unsubscribed", "popup", t1, t2), remote("UNSUBSCRIBED", t2))).toEqual(
      none,
    );
  });
});

describe("checking our list against Shopify", () => {
  it("asks about up to 100 customers at once by id and fixes what drifted", async () => {
    add({ email: "a@x.com", customerId: "1", consentAt: daysAgo(30) });
    add({ email: "b@x.com", customerId: "2", source: "popup", consentAt: daysAgo(2) });
    add({ email: "c@x.com", customerId: "3", consentAt: daysAgo(30) });
    add({
      email: "d@x.com",
      customerId: "4",
      status: "unsubscribed",
      consentAt: daysAgo(30),
      unsubscribedAt: daysAgo(3),
    });
    const shopify = admin([
      {
        nodes: [
          // Shopify-তে পরে আনসাবস্ক্রাইব, webhook হারিয়েছে
          customer("1", "a@x.com", "UNSUBSCRIBED", daysAgo(1)),
          // আমাদের পপ-আপের সম্মতি Shopify-তে পৌঁছায়নি
          customer("2", "b@x.com", "NOT_SUBSCRIBED", null),
          customer("3", "c@x.com", "SUBSCRIBED", daysAgo(30)),
          // এখানে আনসাবস্ক্রাইব, Shopify-তে এখনো পুরনো সম্মতি
          customer("4", "D@x.com", "SUBSCRIBED", daysAgo(30)),
        ],
      },
    ]);

    const { state, done } = await checkStep(shopify, shop, fresh(), NOW);

    expect(shopify.graphql).toHaveBeenCalledTimes(1);
    expect(variables(shopify, 0)).toEqual({
      ids: ["1", "2", "3", "4"].map((id) => `gid://shopify/Customer/${id}`),
    });
    expect(row("a@x.com")).toMatchObject({ status: "unsubscribed", unsubscribedAt: daysAgo(1) });
    expect(row("c@x.com")).toMatchObject({ status: "subscribed" });
    expect(jobs()).toEqual([
      [
        "shopify-consent",
        { email: "b@x.com", state: "SUBSCRIBED", firstName: null, source: "popup" },
      ],
      ["shopify-consent", { email: "d@x.com", state: "UNSUBSCRIBED" }],
    ]);
    // প্রথম মেলানো: Shopify-র নতুন রাজি খোঁজা হয় না
    expect(done).toBe(true);
    expect(state).toMatchObject({ checked: 4, fixed: 3, started: NOW.toISOString() });
  });

  it("looks a customer up by email when the id is unknown or now belongs to someone else", async () => {
    add({ email: "new@x.com", source: "popup", consentAt: daysAgo(1) });
    add({ email: "moved@x.com", customerId: "7", consentAt: daysAgo(40) });
    const shopify = admin([
      { nodes: [customer("7", "other@x.com", "SUBSCRIBED", daysAgo(40))] },
      { customers: { nodes: [customer("20", "new@x.com", "NOT_SUBSCRIBED", null)] } },
      { customers: { nodes: [customer("21", "moved@x.com", "UNSUBSCRIBED", daysAgo(2))] } },
    ]);

    await checkStep(shopify, shop, fresh(), NOW);

    expect(variables(shopify, 1)).toEqual({ query: 'email:"new@x.com"' });
    expect(row("new@x.com")).toMatchObject({ customerId: "20", status: "subscribed" });
    expect(row("moved@x.com")).toMatchObject({ customerId: "21", status: "unsubscribed" });
    expect(jobs()).toEqual([
      [
        "shopify-consent",
        { email: "new@x.com", state: "SUBSCRIBED", firstName: null, source: "popup" },
      ],
    ]);
  });

  it("creates the customer when our opt-in never reached Shopify, but never recreates a deleted one", async () => {
    add({ email: "lost@x.com", source: "popup" });
    add({ email: "gone@x.com", customerId: "9", source: "popup" });
    add({ email: "own@x.com" });
    const nobody = { customers: { nodes: [] } };
    const shopify = admin([{ nodes: [null] }, nobody, nobody, nobody]);

    await checkStep(shopify, shop, fresh(), NOW);

    expect(jobs()).toEqual([
      [
        "shopify-consent",
        { email: "lost@x.com", state: "SUBSCRIBED", firstName: null, source: "popup" },
      ],
    ]);
    expect(row("gone@x.com")).toMatchObject({ customerId: "9", status: "subscribed" });
    expect(row("own@x.com")).toMatchObject({ status: "subscribed" });
  });

  it("checks only recent opt-outs, and never looks up an opt-out Shopify did not know", async () => {
    add({
      email: "old@x.com",
      customerId: "1",
      status: "unsubscribed",
      unsubscribedAt: daysAgo(31),
    });
    add({ email: "noid@x.com", status: "unsubscribed", unsubscribedAt: daysAgo(2) });
    add({ email: "bounce@x.com", customerId: "2", status: "bounced", unsubscribedAt: daysAgo(2) });
    db.subscriber.seed({ shopId: "another-shop", email: "else@x.com", customerId: "3" });
    const shopify = admin([]);

    const { state } = await checkStep(shopify, shop, fresh(), NOW);

    expect(shopify.graphql).not.toHaveBeenCalled();
    expect(state).toMatchObject({ checked: 1, fixed: 0 });
  });

  it("goes through the list a page at a time, then looks for Shopify's new subscribers", async () => {
    for (let i = 0; i < 101; i++) add({ email: `p${i}@x.com`, customerId: String(i + 1) });
    const page = (from: number, to: number) => ({
      nodes: Array.from({ length: to - from }, (_, k) =>
        customer(String(from + k + 1), `p${from + k}@x.com`, "SUBSCRIBED", daysAgo(9)),
      ),
    });
    const since = hoursAgo(25).toISOString();
    const empty = { customers: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
    const shopify = admin([page(0, 100), page(100, 101), empty]);

    let step = await checkStep(shopify, shop, fresh({ since }), NOW);
    expect(step).toMatchObject({
      done: false,
      state: { phase: "ours", cursor: db.subscriber.rows[99]!.id, checked: 100 },
    });
    expect((variables(shopify, 0)?.ids as string[]).length).toBe(100);

    step = await checkStep(shopify, shop, step.state, NOW);
    expect(step).toMatchObject({
      done: false,
      state: { phase: "theirs", cursor: null, checked: 101 },
    });

    step = await checkStep(shopify, shop, step.state, NOW);
    expect(step).toMatchObject({ done: true, state: { checked: 101, fixed: 0 } });
    expect(variables(shopify, 2)).toEqual({
      after: null,
      query: "accepts_marketing:true AND updated_at:>='2026-11-16T02:00:00Z'",
    });
  });
});

describe("finding Shopify's new subscribers", () => {
  it("adds missing subscribers quietly and fixes the ones that drifted", async () => {
    add({
      email: "back@x.com",
      customerId: "2",
      status: "unsubscribed",
      consentAt: daysAgo(60),
      unsubscribedAt: daysAgo(40),
    });
    add({
      email: "stay@x.com",
      customerId: "3",
      status: "unsubscribed",
      consentAt: daysAgo(60),
      unsubscribedAt: daysAgo(40),
    });
    const shopify = admin([
      {
        customers: {
          nodes: [
            {
              ...customer("1", "New@x.com", "SUBSCRIBED", hoursAgo(5)),
              firstName: "Nila",
              tags: ["newsletter", "Popup"],
            },
            { ...customer("2", "back@x.com", "SUBSCRIBED", hoursAgo(3)), tags: [] },
            { ...customer("3", "stay@x.com", "SUBSCRIBED", daysAgo(90)), tags: [] },
            { ...customer("4", "pending@x.com", "PENDING", hoursAgo(1)), tags: [] },
          ],
          pageInfo: { hasNextPage: true, endCursor: "c1" },
        },
      },
    ]);
    const state = {
      ...fresh({ since: hoursAgo(25).toISOString() }),
      phase: "theirs" as const,
    };

    const step = await checkStep(shopify, shop, state, NOW);

    expect(step).toMatchObject({
      done: false,
      state: { phase: "theirs", cursor: "c1", checked: 4, fixed: 3 },
    });
    expect(row("new@x.com")).toMatchObject({
      status: "subscribed",
      source: "popup",
      firstName: "Nila",
      customerId: "1",
      consentAt: hoursAgo(5),
    });
    expect(row("back@x.com")).toMatchObject({
      status: "subscribed",
      consentAt: hoursAgo(3),
      unsubscribedAt: null,
    });
    expect(row("stay@x.com")).toMatchObject({ status: "unsubscribed" });
    expect(row("pending@x.com")).toBeUndefined();
    // নতুনদের welcome ইমেইল বা অন্য কাজ যায় না; শুধু আমাদের আনসাবস্ক্রাইবটা Shopify-তে আবার
    expect(jobs()).toEqual([["shopify-consent", { email: "stay@x.com", state: "UNSUBSCRIBED" }]]);
  });
});

describe("which stores are checked, and when", () => {
  it("queues one check a day for each store that uses the list, spread out over hours", async () => {
    db.toolSetting.seed({ shopId: shop.id, toolId: "email-marketing", enabled: true });
    // Starter প্ল্যানে Email Marketing নেই, কিন্তু Klaviyo যুক্ত: তালিকা কাজে লাগে
    const esp = db.shop.seed({ domain: "esp.myshopify.com", plan: "starter" });
    db.integration.seed({ shopId: esp.id, provider: "klaviyo", secret: "x" });
    const starter = db.shop.seed({ domain: "s.myshopify.com", plan: "starter" });
    db.toolSetting.seed({ shopId: starter.id, toolId: "email-marketing", enabled: true });
    const gone = db.shop.seed({ domain: "g.myshopify.com", uninstalledAt: daysAgo(1) });
    db.toolSetting.seed({ shopId: gone.id, toolId: "email-marketing", enabled: true });
    db.shop.seed({ domain: "n.myshopify.com" });

    expect(await queueConsentChecks(NOW)).toBe(2);
    expect(db.job.rows.map((job) => [job.shopId, job.kind, job.payload, job.runAt])).toEqual([
      [shop.id, "consent-check", { since: null }, NOW],
      [esp.id, "consent-check", { since: null }, new Date(NOW.getTime() + 60_000)],
    ]);

    // একই দিনে আবার ডাকলে নতুন কিছু নয়
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 3_600_000));
    expect(await queueConsentChecks(new Date())).toBe(0);
    expect(db.job.rows).toHaveLength(2);
  });

  it("looks for new subscribers from the start of the last finished check", async () => {
    db.toolSetting.seed({ shopId: shop.id, toolId: "email-marketing", enabled: true });
    db.job.seed({
      shopId: shop.id,
      kind: "consent-check",
      status: "done",
      createdAt: daysAgo(3),
      progress: { started: daysAgo(3).toISOString(), checked: 5, fixed: 0 },
    });
    db.job.seed({
      shopId: shop.id,
      kind: "consent-check",
      status: "failed",
      createdAt: daysAgo(2),
      progress: { started: daysAgo(2).toISOString(), checked: 1, fixed: 0 },
    });

    expect(await queueConsentChecks(NOW)).toBe(1);
    expect(db.job.rows.at(-1)!.payload).toEqual({
      since: new Date(daysAgo(3).getTime() - 3_600_000).toISOString(),
    });
  });

  it("runs as a background job and remembers when it started", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    db.toolSetting.seed({ shopId: shop.id, toolId: "email-marketing", enabled: true });
    add({ email: "a@x.com", customerId: "1", consentAt: daysAgo(30) });
    client = admin([{ nodes: [customer("1", "a@x.com", "UNSUBSCRIBED", daysAgo(1))] }]);

    const job = await enqueueJob(shop.id, "consent-check", { since: null });
    await runJob({ ...job, payload: job.payload as Record<string, unknown>, attempts: 1 });

    expect(db.job.rows[0]).toMatchObject({
      status: "done",
      progress: { started: NOW.toISOString(), checked: 1, fixed: 1 },
    });
    expect(row("a@x.com")).toMatchObject({ status: "unsubscribed" });
  });

  it("stops without asking Shopify once the store no longer uses the list", async () => {
    add({ email: "a@x.com", customerId: "1" });
    client = admin([]);

    const job = await enqueueJob(shop.id, "consent-check", { since: null });
    await runJob({ ...job, payload: job.payload as Record<string, unknown>, attempts: 1 });

    expect(client.graphql).not.toHaveBeenCalled();
    expect(db.job.rows[0]).toMatchObject({ status: "done" });
  });
});
