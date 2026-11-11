import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.SHOPIFY_APP_URL = "https://app.test";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { EMAIL_MONTHLY_CAP } = await import("./plans");
const {
  applyDeliveryEvent,
  deliveryRate,
  enqueueEmail,
  messageStats,
  processMessages,
  recoverStuckMessages,
} = await import("./messages.server");

const now = new Date("2026-11-10T10:00:00Z");
const content = {
  subject: "Hi {first_name}",
  preheader: "",
  heading: "Sale at {shop}",
  body: "Hello",
  buttonText: "Shop",
  buttonUrl: "https://shop.com/sale",
  imageUrl: "",
};

const send = vi.fn();
const deps = { send, now: () => now };

/** আসল SQL-এর (FOR UPDATE SKIP LOCKED) জায়গায়: সময় হওয়া বার্তাগুলো তুলে নেয় */
const claim = async (limit: number) => {
  const due = db.message.rows
    .filter((r) => r.status === "queued" && (r.sendAt as Date) <= now)
    .slice(0, limit);
  for (const row of due) {
    row.status = "sending";
    row.attempts = (row.attempts as number) + 1;
    row.lockedAt = now;
  }
  return due.map((r) => ({ ...r })) as never;
};
const run = () => processMessages(20, deps, claim);
const only = () => db.message.rows[0] as Record<string, unknown>;

let shopId: string;
const marketing = (extra: Record<string, unknown> = {}) =>
  enqueueEmail(shopId, {
    kind: "flow",
    to: "a@b.com",
    sendAt: new Date(now.getTime() - 1000),
    payload: { marketing: true, content, vars: { first_name: "Rahim" }, ...extra },
  });

beforeEach(() => {
  resetFakeDb();
  send.mockReset().mockResolvedValue({ ok: true, providerId: "prov-1" });
  shopId = db.shop.seed({ domain: "tom.myshopify.com" }).id as string;
});

describe("sending marketing email", () => {
  it("sends to a subscriber with an unsubscribe link, one-click header and tracked button", async () => {
    db.subscriber.seed({ shopId, email: "a@b.com" });
    await marketing();
    expect(await run()).toBe(1);

    expect(only()).toMatchObject({ status: "sent", providerId: "prov-1", sentAt: now });
    const mail = send.mock.calls[0]?.[0];
    expect(mail.to).toBe("a@b.com");
    expect(mail.fromName).toBe("tom");
    expect(mail.subject).toBe("Hi Rahim");
    expect(mail.html).toContain("Sale at tom");
    expect(mail.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.test\/e\/u\/.+>$/);
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.html).toContain("https://app.test/e/u/");
    expect(mail.html).toContain(
      `https://app.test/e/c/${only().id}?u=https%3A%2F%2Fshop.com%2Fsale`,
    );
    expect(mail.html).toContain(`https://app.test/e/o/${only().id}.`);
  });

  it("uses the sender name and reply-to the merchant set", async () => {
    db.shop.rows[0]!.emailSettings = { senderName: "Tom's Tees", replyTo: "help@tom.com" };
    db.subscriber.seed({ shopId, email: "a@b.com" });
    await marketing();
    await run();
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      fromName: "Tom's Tees",
      replyTo: "help@tom.com",
    });
  });

  it("never emails someone who unsubscribed after the email was queued", async () => {
    db.subscriber.seed({ shopId, email: "a@b.com", status: "unsubscribed" });
    await marketing({ allowNonSubscribers: true });
    await run();
    expect(only()).toMatchObject({ status: "skipped", error: "unsubscribed" });
    expect(send).not.toHaveBeenCalled();
  });

  it("only emails people on the list, unless the email is allowed for non-subscribers", async () => {
    await marketing();
    await run();
    expect(only()).toMatchObject({ status: "skipped", error: "not_subscribed" });

    resetFakeDb();
    shopId = db.shop.seed({ domain: "tom.myshopify.com" }).id as string;
    await marketing({ allowNonSubscribers: true });
    await run();
    expect(only().status).toBe("sent");
  });

  it("never emails an address that bounced or complained, even for non-marketing email", async () => {
    db.subscriber.seed({ shopId, email: "a@b.com", status: "bounced" });
    await enqueueEmail(shopId, {
      kind: "back-in-stock",
      to: "a@b.com",
      sendAt: new Date(now.getTime() - 1000),
      payload: { marketing: false, content },
    });
    await run();
    expect(only()).toMatchObject({ status: "skipped", error: "suppressed" });
  });

  it("still sends a withdrawal confirmation to such an address, with no tracking in it", async () => {
    // আইনে বাধ্যতামূলক, আর ক্রেতা এইমাত্র নিজে এই ঠিকানা দিয়েছেন
    for (const [email, status] of [
      ["a@b.com", "bounced"],
      ["c@b.com", "complained"],
      ["d@b.com", "unsubscribed"],
    ] as const) {
      db.subscriber.seed({ shopId, email, status });
      await enqueueEmail(shopId, {
        kind: "withdrawal",
        to: email,
        sendAt: new Date(now.getTime() - 1000),
        payload: { marketing: false, content },
      });
    }
    await run();
    expect(db.message.rows.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
    const mail = send.mock.calls[0]?.[0];
    expect(mail.headers).toBeUndefined();
    // খোলা গোনার ছবি নেই, বাটনের লিংকও সরাসরি (ক্লিক গোনা হয় না)
    expect(mail.html).not.toContain("/e/o/");
    expect(mail.html).not.toContain("/e/c/");
    expect(mail.html).toContain('href="https://shop.com/sale"');
    expect(mail.html).not.toContain("Unsubscribe");
  });

  it("skips an abandoned checkout email when the order was placed meanwhile", async () => {
    const checkout = db.abandonedCheckout.seed({ shopId, token: "t", completedAt: now });
    await marketing({ allowNonSubscribers: true, checkoutId: checkout.id });
    await run();
    expect(only()).toMatchObject({ status: "skipped", error: "ordered" });
  });

  it("loads campaign content once and skips when the campaign is gone", async () => {
    db.subscriber.seed({ shopId, email: "a@b.com" });
    const campaign = db.emailCampaign.seed({ shopId, name: "Eid", content });
    await enqueueEmail(shopId, {
      kind: "campaign",
      to: "a@b.com",
      sendAt: new Date(now.getTime() - 1000),
      payload: { marketing: true, campaignId: campaign.id as string, vars: { first_name: "Mina" } },
    });
    await enqueueEmail(shopId, {
      kind: "campaign",
      to: "a@b.com",
      sendAt: new Date(now.getTime() - 500),
      payload: { marketing: true, campaignId: "missing" },
    });
    await run();
    expect(db.message.rows.map((r) => [r.status, r.error])).toEqual([
      ["sent", null],
      ["skipped", "no_content"],
    ]);
    expect(send.mock.calls[0]?.[0].subject).toBe("Hi Mina");
  });
});

describe("plan and monthly limit", () => {
  it("does not send email for a shop without the Professional plan", async () => {
    db.shop.rows[0]!.plan = "starter";
    db.subscriber.seed({ shopId, email: "a@b.com" });
    await marketing();
    await run();
    expect(only()).toMatchObject({ status: "skipped", error: "plan" });
  });

  it("stops at the monthly limit, but still sends legally required email", async () => {
    const original = EMAIL_MONTHLY_CAP.professional;
    EMAIL_MONTHLY_CAP.professional = 2;
    try {
      for (const email of ["a@b.com", "b@b.com", "c@b.com"]) {
        db.subscriber.seed({ shopId, email });
        await enqueueEmail(shopId, {
          kind: "campaign",
          to: email,
          sendAt: new Date(now.getTime() - 1000),
          payload: { marketing: true, content },
        });
      }
      await enqueueEmail(shopId, {
        kind: "withdrawal",
        to: "d@b.com",
        sendAt: new Date(now.getTime() - 1000),
        payload: { marketing: false, content },
      });
      await run();
      expect(db.message.rows.map((r) => [r.recipient, r.status, r.error])).toEqual([
        ["a@b.com", "sent", null],
        ["b@b.com", "sent", null],
        ["c@b.com", "skipped", "monthly_limit"],
        ["d@b.com", "sent", null],
      ]);
    } finally {
      EMAIL_MONTHLY_CAP.professional = original;
    }
  });

  it("skips everything for an uninstalled shop", async () => {
    db.shop.rows[0]!.uninstalledAt = now;
    db.subscriber.seed({ shopId, email: "a@b.com" });
    await marketing();
    await run();
    expect(only()).toMatchObject({ status: "skipped", error: "uninstalled" });
  });
});

describe("failures", () => {
  it("marks the email skipped (not failed) when no email provider is set up", async () => {
    send.mockResolvedValue({ ok: false, error: "email_not_configured", permanent: true });
    db.subscriber.seed({ shopId, email: "a@b.com" });
    await marketing();
    await run();
    expect(only()).toMatchObject({ status: "skipped", error: "email_not_configured" });
  });

  it("retries a temporary failure later, and gives up after four tries", async () => {
    send.mockResolvedValue({ ok: false, error: "503 busy" });
    db.subscriber.seed({ shopId, email: "a@b.com" });
    await marketing();
    await run();
    expect(only()).toMatchObject({ status: "queued", error: "503 busy", attempts: 1 });
    expect((only().sendAt as Date).getTime()).toBe(now.getTime() + 5 * 60_000);

    for (let i = 0; i < 3; i++) {
      only().sendAt = new Date(now.getTime() - 1);
      await run();
    }
    expect(only()).toMatchObject({ status: "failed", error: "503 busy", attempts: 4 });
  });

  it("does not retry a permanent failure", async () => {
    send.mockResolvedValue({ ok: false, error: "422 bad address", permanent: true });
    db.subscriber.seed({ shopId, email: "a@b.com" });
    await marketing();
    await run();
    expect(only()).toMatchObject({ status: "failed", error: "422 bad address", attempts: 1 });
  });

  it("puts messages stuck in 'sending' back in the queue after 15 minutes", async () => {
    db.message.seed({ shopId, status: "sending", lockedAt: new Date(now.getTime() - 16 * 60_000) });
    db.message.seed({ shopId, status: "sending", lockedAt: new Date(now.getTime() - 60_000) });
    await recoverStuckMessages(now);
    expect(db.message.rows.map((r) => r.status)).toEqual(["queued", "sending"]);
  });
});

describe("queueing and reports", () => {
  it("queues the same message only once", async () => {
    const input = {
      kind: "flow" as const,
      to: "a@b.com",
      dedupeKey: "flow:welcome:a@b.com",
      payload: { marketing: true, content },
    };
    expect(await enqueueEmail(shopId, input)).toBe(true);
    expect(await enqueueEmail(shopId, input)).toBe(false);
    expect(db.message.rows).toHaveLength(1);
  });

  it("does not send before the scheduled time", async () => {
    db.subscriber.seed({ shopId, email: "a@b.com" });
    await enqueueEmail(shopId, {
      kind: "flow",
      to: "a@b.com",
      sendAt: new Date(now.getTime() + 60_000),
      payload: { marketing: true, content },
    });
    expect(await run()).toBe(0);
    expect(only().status).toBe("queued");
  });

  it("works out the delivery rate from accepted, bounced and failed (skipped is not counted)", () => {
    const stats = deliveryRate({
      sent: 90,
      delivered: 6,
      bounced: 2,
      complained: 1,
      failed: 1,
      skipped: 40,
    });
    expect(stats).toMatchObject({ accepted: 96, bounced: 3, failed: 1, skipped: 40, rate: 96 });
    expect(deliveryRate({}).rate).toBeNull();
    expect(deliveryRate({ skipped: 5 }).rate).toBeNull();
  });

  it("reports per campaign", async () => {
    db.message.seed({
      shopId,
      channel: "email",
      kind: "campaign",
      refId: "c1",
      status: "sent",
      openedAt: now,
    });
    db.message.seed({ shopId, channel: "email", kind: "campaign", refId: "c1", status: "bounced" });
    db.message.seed({ shopId, channel: "email", kind: "campaign", refId: "c2", status: "sent" });
    expect(await messageStats(shopId, { kind: "campaign", refId: "c1" })).toMatchObject({
      accepted: 1,
      bounced: 1,
      opened: 1,
      rate: 50,
    });
    expect(await messageStats(shopId)).toMatchObject({ accepted: 2, bounced: 1 });
  });
});

describe("delivery events from the provider", () => {
  it("marks delivered, and a late 'delivered' never hides a bounce", async () => {
    db.message.seed({
      shopId,
      channel: "email",
      recipient: "a@b.com",
      status: "sent",
      providerId: "p1",
    });
    expect(await applyDeliveryEvent({ type: "delivered", providerId: "p1", recipients: [] })).toBe(
      true,
    );
    expect(only().status).toBe("delivered");

    only().status = "bounced";
    await applyDeliveryEvent({ type: "delivered", providerId: "p1", recipients: [] });
    expect(only().status).toBe("bounced");
  });

  it("stops emailing an address after a bounce", async () => {
    db.subscriber.seed({ shopId, email: "a@b.com" });
    db.message.seed({
      shopId,
      channel: "email",
      recipient: "a@b.com",
      status: "sent",
      providerId: "p1",
    });
    await applyDeliveryEvent({ type: "bounced", providerId: "p1", recipients: ["a@b.com"] });
    expect(only().status).toBe("bounced");
    expect(db.subscriber.rows[0]).toMatchObject({ status: "bounced" });
    expect(db.job.rows).toHaveLength(0);
  });

  it("treats a spam complaint as an unsubscribe everywhere", async () => {
    db.integration.seed({ shopId, provider: "klaviyo", secret: "x" });
    db.message.seed({
      shopId,
      channel: "email",
      recipient: "new@b.com",
      status: "sent",
      providerId: "p2",
    });
    await applyDeliveryEvent({ type: "complained", providerId: "p2", recipients: [] });
    expect(db.subscriber.rows[0]).toMatchObject({ email: "new@b.com", status: "complained" });
    expect(
      db.job.rows.map((j) => [
        j.kind,
        (j.payload as { action?: string; state?: string }).action ??
          (j.payload as { state?: string }).state,
      ]),
    ).toEqual([
      ["shopify-consent", "UNSUBSCRIBED"],
      ["esp-sync", "unsubscribe"],
    ]);
  });

  it("ignores an event for a message it does not know", async () => {
    expect(await applyDeliveryEvent({ type: "bounced", providerId: "nope", recipients: [] })).toBe(
      false,
    );
  });
});
