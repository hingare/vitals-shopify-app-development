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

beforeEach(() => {
  resetFakeDb();
  shopId = db.shop.seed({ domain: "tom.myshopify.com" }).id as string;
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
    await expect(saveCampaign("other-shop", id, { name: "hijack", content })).rejects.toThrow();
    expect(await startCampaign("other-shop", id)).toBe(false);
    expect(db.emailCampaign.rows[0]).toMatchObject({ name: "Eid", status: "draft" });
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
