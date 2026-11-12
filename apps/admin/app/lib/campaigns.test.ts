import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const {
  CampaignError,
  DEFAULT_CAMPAIGN,
  deleteCampaign,
  queueCampaignSlice,
  saveCampaign,
  scheduleCampaign,
  sendTestEmail,
  startCampaign,
  startDueCampaigns,
} = await import("./campaigns.server");

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
