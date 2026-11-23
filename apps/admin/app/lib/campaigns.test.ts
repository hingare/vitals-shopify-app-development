import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
// পাঠানোর কাজ স্টোরের Admin API পায় নকলটা থেকে (আসল Shopify লাইব্রেরি চালু করতে হয় না)
vi.mock("./admin-client.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admin-client.server")>()),
  offlineAdmin: async () => client,
}));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const {
  CampaignError,
  DEFAULT_CAMPAIGN,
  deleteCampaign,
  queueCampaignSlice,
  queueSegmentMembers,
  saveCampaign,
  scheduleCampaign,
  sendTestEmail,
  startCampaign,
  startDueCampaigns,
} = await import("./campaigns.server");
const { runJob } = await import("./queue.server");

/** নকল Admin API: উত্তরগুলো পরপর ফেরত দেয় (Error দিলে GraphQL ত্রুটি), আর কী জিজ্ঞেস করা হলো তা রাখে */
const admin = (responses: unknown[]) => {
  const graphql = vi.fn<
    (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>
  >(async () => {
    const next = responses.shift();
    return next instanceof Error
      ? Response.json({ errors: [{ message: next.message }] })
      : Response.json({ data: next });
  });
  return { graphql };
};
let client = admin([]);

const content = { ...DEFAULT_CAMPAIGN, subject: "Eid sale", buttonUrl: "https://tom.com/sale" };
let shopId: string;

/** Professional প্ল্যানের স্টোর, Email Marketing চালু */
function seedShop(domain: string) {
  const id = db.shop.seed({ domain }).id as string;
  db.toolSetting.seed({ shopId: id, toolId: "email-marketing", enabled: true });
  return id;
}
const toolOff = () => {
  db.toolSetting.rows[0]!.enabled = false;
};

beforeEach(() => {
  resetFakeDb();
  shopId = seedShop("tom.myshopify.com");
  client = admin([]);
});

describe("campaign drafts", () => {
  it("saves a draft and lets it be edited until sending starts", async () => {
    const id = await saveCampaign(shopId, null, { name: "  Eid  ", content });
    expect(db.emailCampaign.rows[0]).toMatchObject({ name: "Eid", status: "draft" });
    await saveCampaign(shopId, id, { name: "Eid 2", content });
    expect(db.emailCampaign.rows[0]?.name).toBe("Eid 2");

    await startCampaign(shopId, id);
    await expect(saveCampaign(shopId, id, { name: "late edit", content })).rejects.toThrow(
      CampaignError,
    );
    await deleteCampaign(shopId, id);
    expect(db.emailCampaign.rows).toHaveLength(1);
  });

  it("rejects content without a subject or with an unsafe link", async () => {
    await expect(
      saveCampaign(shopId, null, { name: "x", content: { ...content, subject: "" } }),
    ).rejects.toThrow();
    await expect(
      saveCampaign(shopId, null, { name: "x", content: { ...content, buttonUrl: "http://a.com" } }),
    ).rejects.toThrow();
  });

  it("cannot touch another shop's campaign", async () => {
    const id = await saveCampaign(shopId, null, { name: "Eid", content });
    const other = seedShop("other.myshopify.com");
    await expect(saveCampaign(other, id, { name: "hijack", content })).rejects.toThrow();
    expect(await startCampaign(other, id)).toBe(false);
    await expect(scheduleCampaign(other, id, new Date())).rejects.toThrow(CampaignError);
    await deleteCampaign(other, id);
    expect(db.emailCampaign.rows[0]).toMatchObject({ name: "Eid", status: "draft" });
    expect(db.job.rows).toHaveLength(0);
  });
});

describe("sending", () => {
  it("starts only once, however many times send is pressed", async () => {
    const id = await saveCampaign(shopId, null, { name: "Eid", content });
    expect(await startCampaign(shopId, id)).toBe(true);
    expect(await startCampaign(shopId, id)).toBe(false);
    expect(db.job.rows.filter((j) => j.kind === "campaign-send")).toHaveLength(1);
    expect(db.emailCampaign.rows[0]?.status).toBe("sending");
  });

  it("queues one message per subscribed person, and none twice if the step reruns", async () => {
    const id = await saveCampaign(shopId, null, { name: "Eid", content });
    db.subscriber.seed({ shopId, email: "a@b.com", firstName: "Rahim" });
    db.subscriber.seed({ shopId, email: "b@b.com" });
    db.subscriber.seed({ shopId, email: "gone@b.com", status: "unsubscribed" });
    db.subscriber.seed({ shopId: "other-shop", email: "c@b.com" });

    expect(await queueCampaignSlice(shopId, id, "")).toEqual({ queued: 2, next: null });
    expect(await queueCampaignSlice(shopId, id, "")).toEqual({ queued: 0, next: null });
    expect(db.message.rows.map((m) => [m.recipient, m.kind, m.refId])).toEqual([
      ["a@b.com", "campaign", id],
      ["b@b.com", "campaign", id],
    ]);
    expect(db.message.rows[0]?.payload).toEqual({
      campaignId: id,
      marketing: true,
      vars: { first_name: "Rahim" },
    });
    expect((db.message.rows[1]?.payload as { vars: { first_name: string } }).vars.first_name).toBe(
      "there",
    );
  });

  it("starts scheduled campaigns when their time comes", async () => {
    const now = new Date("2026-11-10T10:00:00Z");
    const due = await saveCampaign(shopId, null, { name: "Due", content });
    const later = await saveCampaign(shopId, null, { name: "Later", content });
    await scheduleCampaign(shopId, due, new Date(now.getTime() - 60_000));
    await scheduleCampaign(shopId, later, new Date(now.getTime() + 3_600_000));
    expect(await startDueCampaigns(now)).toBe(1);
    expect(db.emailCampaign.rows.map((c) => c.status)).toEqual(["sending", "scheduled"]);

    await scheduleCampaign(shopId, later, null);
    expect(db.emailCampaign.rows[1]).toMatchObject({ status: "draft", scheduledAt: null });
  });

  it("cannot be sent or scheduled while Email Marketing is off, or on a plan without it", async () => {
    const id = await saveCampaign(shopId, null, { name: "Eid", content });
    toolOff();
    await expect(startCampaign(shopId, id)).rejects.toMatchObject({ code: "tool_off" });
    await expect(scheduleCampaign(shopId, id, new Date())).rejects.toMatchObject({
      code: "tool_off",
    });
    // খসড়া হিসেবে থাকে আর বদলানো যায়; একবারের ক্যাম্পেইনটা নষ্ট হয় না
    await saveCampaign(shopId, id, { name: "Eid 2", content });
    expect(db.emailCampaign.rows[0]).toMatchObject({ name: "Eid 2", status: "draft" });
    expect(db.job.rows).toHaveLength(0);

    db.toolSetting.rows[0]!.enabled = true;
    db.shop.rows[0]!.plan = "starter";
    await expect(startCampaign(shopId, id)).rejects.toMatchObject({ code: "tool_off" });
  });

  it("puts a scheduled campaign back to draft if the tool is off when its time comes", async () => {
    const now = new Date("2026-11-10T10:00:00Z");
    const id = await saveCampaign(shopId, null, { name: "Due", content });
    await scheduleCampaign(shopId, id, new Date(now.getTime() - 60_000));
    toolOff();
    // বন্ধ থাকা অবস্থায় সময় তুলে নেওয়া (খসড়ায় ফেরানো) সবসময় চলে
    const later = await saveCampaign(shopId, null, { name: "Later", content });
    await scheduleCampaign(shopId, later, null);

    expect(await startDueCampaigns(now)).toBe(0);
    expect(db.emailCampaign.rows[0]).toMatchObject({ status: "draft", scheduledAt: null });
    expect(db.job.rows).toHaveLength(0);

    // পরে টুল চালু করলে ক্যাম্পেইনটা নিজে থেকে চলে যায় না; মার্চেন্টকে আবার পাঠাতে হয়
    db.toolSetting.rows[0]!.enabled = true;
    expect(await startDueCampaigns(now)).toBe(0);
    expect(db.emailCampaign.rows[0]?.status).toBe("draft");
    expect(await startCampaign(shopId, id, now)).toBe(true);
  });
});

describe("customer segments", () => {
  const SEGMENT = "gid://shopify/Segment/5";
  const QUERY = "gid://shopify/CustomerSegmentMembersQuery/7";
  const vip = { id: SEGMENT, name: "VIP" };
  const campaign = () => db.emailCampaign.rows[0]!;
  const sendJob = () => db.job.rows.find((j) => j.kind === "campaign-send")!;
  /** লাইনের campaign-send কাজের এক ধাপ, যেন worker ধরেছে (attempts = এটা কত নম্বর চেষ্টা) */
  async function step(attempts = 1) {
    const job = sendJob();
    await runJob({
      id: job.id as string,
      shopId: job.shopId as string,
      kind: "campaign-send",
      payload: job.payload as Record<string, unknown>,
      attempts,
    });
    return sendJob();
  }
  const add = (email: string, customerId: string | null, status = "subscribed") =>
    db.subscriber.seed({ shopId, email, customerId, status });
  const member = (id: string, email: string | null) => ({
    node: {
      id: `gid://shopify/CustomerSegmentMember/${id}`,
      defaultEmailAddress: email === null ? null : { emailAddress: email },
    },
  });
  const page = (edges: unknown[], next: string | null) => ({
    customerSegmentMembers: { edges, pageInfo: { hasNextPage: next !== null, endCursor: next } },
  });
  const created = (done: boolean) => ({
    customerSegmentMembersQueryCreate: {
      customerSegmentMembersQuery: { id: QUERY, done },
      userErrors: [],
    },
  });
  const status = (done: boolean) => ({ customerSegmentMembersQuery: { id: QUERY, done } });

  it("remembers the chosen segment until the merchant picks another audience", async () => {
    const id = await saveCampaign(shopId, null, { name: "VIP", content, segment: vip });
    expect(campaign()).toMatchObject({ segmentId: SEGMENT, segmentName: "VIP" });
    await saveCampaign(shopId, id, { name: "VIP 2", content });
    expect(campaign()).toMatchObject({ name: "VIP 2", segmentId: SEGMENT });
    await saveCampaign(shopId, id, { name: "Everyone", content, segment: null });
    expect(campaign()).toMatchObject({ segmentId: null, segmentName: null });
  });

  it("queues only the segment's subscribed customers, matched by customer id or email, once", async () => {
    const id = await saveCampaign(shopId, null, { name: "VIP", content, segment: vip });
    add("a@b.com", "11");
    add("b@b.com", null);
    add("gone@b.com", "13", "unsubscribed");
    add("other@b.com", "14");
    db.subscriber.seed({ shopId: "other-shop", email: "a@b.com", customerId: "11" });
    const members = [
      { customerId: "11", email: "new-address@b.com" },
      { customerId: "12", email: "b@b.com" },
      { customerId: "13", email: "gone@b.com" },
      { customerId: "11", email: null },
    ];

    expect(await queueSegmentMembers(shopId, id, members)).toBe(2);
    expect(await queueSegmentMembers(shopId, id, members)).toBe(0);
    expect(await queueSegmentMembers(shopId, id, [])).toBe(0);
    expect(db.message.rows.map((m) => [m.shopId, m.recipient, m.refId])).toEqual([
      [shopId, "a@b.com", id],
      [shopId, "b@b.com", id],
    ]);
  });

  it("sends through Shopify's member list: build it, wait for it, then page by page", async () => {
    add("a@b.com", "11");
    add("b@b.com", null);
    add("c@b.com", "13");
    add("not-in-segment@b.com", "14");
    const id = await saveCampaign(shopId, null, { name: "VIP", content, segment: vip });
    client = admin([
      created(false),
      status(false),
      status(true),
      page([member("11", "a@b.com"), member("12", " B@B.com ")], "p1"),
      page([member("13", null)], null),
    ]);
    await startCampaign(shopId, id);

    let job = await step();
    expect(client.graphql.mock.calls[0]?.[1]?.variables).toEqual({
      input: { segmentId: SEGMENT },
    });
    expect(job).toMatchObject({ status: "pending", payload: { queryId: QUERY, ready: false } });
    expect((job.runAt as Date).getTime()).toBeGreaterThan(Date.now());

    job = await step();
    expect(job).toMatchObject({ status: "pending", payload: { ready: false, polls: 1 } });
    job = await step();
    expect(job.payload).toMatchObject({ ready: true });

    job = await step();
    expect(client.graphql.mock.calls[3]?.[1]?.variables).toEqual({ queryId: QUERY, after: null });
    expect(job).toMatchObject({ status: "pending", payload: { cursor: "p1", queued: 2 } });
    // পাতার মাঝে বিরতি, যাতে বড় সেগমেন্টে Shopify থামিয়ে না দেয়
    expect((job.runAt as Date).getTime()).toBeGreaterThan(Date.now());
    expect(campaign().status).toBe("sending");

    job = await step();
    expect(client.graphql.mock.calls[4]?.[1]?.variables).toEqual({ queryId: QUERY, after: "p1" });
    expect(job.status).toBe("done");
    expect(campaign()).toMatchObject({ status: "sent", recipients: 3, error: null });
    expect(db.message.rows.map((m) => m.recipient)).toEqual(["a@b.com", "b@b.com", "c@b.com"]);
  });

  it("starts from Shopify's list right away when it is already built", async () => {
    add("a@b.com", "11");
    const id = await saveCampaign(shopId, null, { name: "VIP", content, segment: vip });
    client = admin([created(true), page([member("11", "a@b.com")], null)]);
    await startCampaign(shopId, id);
    await step();
    expect(sendJob().payload).toMatchObject({ ready: true });
    await step();
    expect(client.graphql).toHaveBeenCalledTimes(2);
    expect(campaign()).toMatchObject({ status: "sent", recipients: 1 });
  });

  it("sends to everyone without asking Shopify when no segment is chosen", async () => {
    add("a@b.com", "11");
    add("b@b.com", null);
    const id = await saveCampaign(shopId, null, { name: "All", content });
    await startCampaign(shopId, id);
    await step();
    expect(client.graphql).not.toHaveBeenCalled();
    expect(campaign()).toMatchObject({ status: "sent", recipients: 2 });
  });

  it("goes back to draft with a note when the segment was deleted before sending", async () => {
    add("a@b.com", "11");
    const id = await saveCampaign(shopId, null, { name: "VIP", content, segment: vip });
    client = admin([
      {
        customerSegmentMembersQueryCreate: {
          customerSegmentMembersQuery: null,
          userErrors: [{ field: ["input", "segmentId"], message: "Segment does not exist" }],
        },
      },
    ]);
    await startCampaign(shopId, id);
    expect((await step()).status).toBe("done");
    expect(campaign()).toMatchObject({ status: "draft", sentAt: null, error: "segment_missing" });
    expect(db.message.rows).toHaveLength(0);

    // খসড়াটা আবার বদলানো যায়, আর সেভ করলে নোটটা চলে যায়
    await saveCampaign(shopId, id, { name: "Everyone", content, segment: null });
    expect(campaign()).toMatchObject({ status: "draft", error: null });
  });

  it("gives up and goes back to draft when Shopify takes too long to build the list", async () => {
    const id = await saveCampaign(shopId, null, { name: "VIP", content, segment: vip });
    await startCampaign(shopId, id);
    sendJob().payload = { campaignId: id, queryId: QUERY, ready: false, polls: 119 };
    client = admin([status(false)]);
    await step();
    expect(campaign()).toMatchObject({ status: "draft", error: "segment_timeout" });
    expect(sendJob().status).toBe("done");
  });

  it("stops instead of staying stuck in sending when every try fails", async () => {
    const id = await saveCampaign(shopId, null, { name: "VIP", content, segment: vip });
    await startCampaign(shopId, id);
    client = admin([new Error("Throttled"), new Error("Throttled")]);

    // সাময়িক সমস্যায় কাজটা আবার লাইনে যায়, ক্যাম্পেইন পাঠানো অবস্থাতেই থাকে
    expect(await step(1)).toMatchObject({ status: "pending", error: "Throttled" });
    expect(campaign().status).toBe("sending");

    expect(await step(3)).toMatchObject({ status: "failed" });
    expect(campaign()).toMatchObject({ status: "draft", error: "send_failed" });
  });

  it("keeps what was already queued when a later page keeps failing", async () => {
    const id = await saveCampaign(shopId, null, { name: "VIP", content, segment: vip });
    await startCampaign(shopId, id);
    sendJob().payload = { campaignId: id, queryId: QUERY, ready: true, cursor: "p1", queued: 5 };
    client = admin([new Error("Internal error")]);
    await step(3);
    expect(campaign()).toMatchObject({ status: "sent", recipients: 5, error: "send_failed" });
  });

  it("clears an old stop note when the campaign is sent again", async () => {
    const id = await saveCampaign(shopId, null, { name: "VIP", content, segment: vip });
    campaign().error = "segment_missing";
    await startCampaign(shopId, id);
    expect(campaign()).toMatchObject({ status: "sending", error: null });
  });
});

describe("test email", () => {
  const shop = () => ({ id: shopId, domain: "tom.myshopify.com", emailSettings: null });

  it("tells the merchant plainly when no email provider is set up", async () => {
    const result = await sendTestEmail(shop(), content, "me@tom.com");
    expect(result).toMatchObject({ ok: false, error: "email_not_configured" });
    expect(db.message.rows[0]).toMatchObject({ kind: "test", status: "failed" });
  });

  it("validates the address and the content before sending anything", async () => {
    expect((await sendTestEmail(shop(), content, "nope")).ok).toBe(false);
    expect((await sendTestEmail(shop(), { subject: "" }, "me@tom.com")).ok).toBe(false);
    expect(db.message.rows).toHaveLength(0);
  });
});
