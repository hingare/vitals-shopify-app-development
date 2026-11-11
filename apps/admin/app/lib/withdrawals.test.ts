import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.SHOPIFY_APP_URL = "https://app.test";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { processMessages } = await import("./messages.server");
const { listWithdrawals, openWithdrawals, setWithdrawalStatus, submittedText, submitWithdrawal } =
  await import("./withdrawals.server");

const now = new Date("2026-11-11T07:12:00Z");
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

let shop: { id: string; plan: string | null; domain: string };
const statement = (extra: Record<string, unknown> = {}) => ({
  name: "Anna Schmidt",
  email: "Anna@Example.com",
  order: "#1001",
  details: "The blue jacket only",
  locale: "en",
  ...extra,
});

/** লাইনে থাকা ইমেইল সত্যি সত্যি বানিয়ে দেখা (পাঠানোর জায়গায় নকল) */
const send = vi.fn();
async function deliver(at = now) {
  const claim = async (limit: number) => {
    const due = db.message.rows.filter((r) => r.status === "queued").slice(0, limit);
    for (const row of due) {
      row.status = "sending";
      row.attempts = ((row.attempts as number) ?? 0) + 1;
    }
    return due.map((r) => ({ ...r })) as never;
  };
  await processMessages(20, { send, now: () => at }, claim);
  return send.mock.calls.map(
    (call) => call[0] as { to: string; subject: string; html: string; text: string },
  );
}

beforeEach(() => {
  resetFakeDb();
  send.mockReset().mockResolvedValue({ ok: true, providerId: "prov-1" });
  const row = db.shop.seed({ domain: "tom.myshopify.com", plan: "professional" });
  shop = { id: row.id as string, plan: "professional", domain: "tom.myshopify.com" };
  db.toolSetting.seed({ shopId: shop.id, toolId: "eu-withdrawal", enabled: true, settings: {} });
});

describe("submitWithdrawal", () => {
  it("saves the statement and confirms it by email with its content, date and time", async () => {
    const result = await submitWithdrawal(shop, statement(), now);
    expect(result).toMatchObject({
      ok: true,
      repeated: false,
      submittedAt: now,
      // স্টোরের পেজে এই লেখাটাই দেখানো হয়, তাই ইমেইলের সাথে হুবহু মেলে
      submitted: "November 11, 2026 at 7:12 AM UTC",
    });

    expect(db.withdrawalRequest.rows).toHaveLength(1);
    expect(db.withdrawalRequest.rows[0]).toMatchObject({
      shopId: shop.id,
      name: "Anna Schmidt",
      email: "anna@example.com",
      orderNumber: "#1001",
      details: "The blue jacket only",
      status: "new",
      createdAt: now,
    });

    const [mail] = await deliver();
    expect(mail?.to).toBe("anna@example.com");
    expect(mail?.subject).toBe("We received your withdrawal");
    expect(mail?.text).toContain("Hello Anna Schmidt,");
    expect(mail?.text).toContain("for order #1001");
    expect(mail?.text).toContain(
      [
        "Name: Anna Schmidt",
        "Order: #1001",
        "Email: anna@example.com",
        "Details: The blue jacket only",
        "Received on: November 11, 2026 at 7:12 AM UTC",
      ].join("\n"),
    );
    expect(db.message.rows[0]).toMatchObject({ kind: "withdrawal", status: "sent" });
  });

  it("always adds what was sent, even when the merchant's text is empty or uses no placeholders", async () => {
    db.toolSetting.rows[0]!.settings = { ackSubject: "Widerruf erhalten", ackBody: "" };
    await submitWithdrawal(shop, statement({ details: "" }), now);
    const [mail] = await deliver();
    expect(mail?.subject).toBe("Widerruf erhalten");
    expect(mail?.text).toContain(
      "Name: Anna Schmidt\nOrder: #1001\nEmail: anna@example.com\nReceived on:",
    );
    expect(mail?.text).not.toContain("Details:");
  });

  it("fills {date} and {shop} in the merchant's text", async () => {
    db.toolSetting.rows[0]!.settings = { ackBody: "{shop} got it on {date}." };
    await submitWithdrawal(shop, statement(), now);
    const [mail] = await deliver();
    expect(mail?.text).toContain("tom got it on November 11, 2026 at 7:12 AM UTC.");
  });

  it("treats what the customer typed as plain text", async () => {
    await submitWithdrawal(
      shop,
      statement({
        name: "<script>alert(1)</script> {shop}",
        details: "{email} <b>x</b>\n\n\nsecond line",
      }),
      now,
    );
    const [mail] = await deliver();
    expect(mail?.html).not.toContain("<script>");
    expect(mail?.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; {shop}");
    expect(mail?.html).toContain("{email} &lt;b&gt;x&lt;/b&gt;<br>second line");
    expect(db.withdrawalRequest.rows[0]?.details).toBe("{email} <b>x</b>\nsecond line");
  });

  it("cleans up spacing and control characters", async () => {
    await submitWithdrawal(
      shop,
      statement({
        name: "  Anna \n\t Schmidt\u0000 ",
        order: " #10\r\n01 ",
        details: "a  \r\nb\u0007",
      }),
      now,
    );
    expect(db.withdrawalRequest.rows[0]).toMatchObject({
      name: "Anna Schmidt",
      orderNumber: "#10 01",
      details: "a\nb",
    });
  });

  it("accepts a statement without details", async () => {
    const result = await submitWithdrawal(shop, { name: "A", email: "a@b.co", order: "1" }, now);
    expect(result.ok).toBe(true);
    expect(db.withdrawalRequest.rows[0]?.details).toBe("");
  });

  it("rejects a statement with a missing or oversized field", async () => {
    const bad = [
      { name: "" },
      { name: "   " },
      { name: 12 },
      { name: "x".repeat(121) },
      { order: "" },
      { order: "x".repeat(41) },
      { email: "not-an-email" },
      { email: null },
      { details: "x".repeat(1001) },
      { details: 5 },
    ];
    for (const extra of bad) {
      expect(await submitWithdrawal(shop, statement(extra), now)).toEqual({
        ok: false,
        error: "invalid",
      });
    }
    expect(db.withdrawalRequest.rows).toHaveLength(0);
    expect(db.message.rows).toHaveLength(0);
  });

  it("does nothing when the tool is off or the plan does not include it", async () => {
    expect(await submitWithdrawal({ ...shop, plan: "starter" }, statement(), now)).toEqual({
      ok: false,
      error: "disabled",
    });
    db.toolSetting.rows[0]!.enabled = false;
    expect(await submitWithdrawal(shop, statement(), now)).toEqual({
      ok: false,
      error: "disabled",
    });
    expect(db.withdrawalRequest.rows).toHaveLength(0);
  });

  it("counts a second click on the same order as the first statement", async () => {
    const first = await submitWithdrawal(shop, statement(), now);
    const again = await submitWithdrawal(
      shop,
      statement({ order: "#1001", name: "Anna" }),
      minutes(5),
    );
    expect(again).toMatchObject({
      ok: true,
      repeated: true,
      submittedAt: now,
      submitted: "November 11, 2026 at 7:12 AM UTC",
    });
    expect(first.ok && again.ok && again.id === first.id).toBe(true);
    expect(db.withdrawalRequest.rows).toHaveLength(1);
    expect(db.message.rows).toHaveLength(1);

    // পরে আবার জমা দিলে সেটা নতুন বিবৃতি (যেমন অন্য পণ্যের জন্য)
    const later = await submitWithdrawal(shop, statement(), minutes(11));
    expect(later).toMatchObject({ ok: true, repeated: false });
    expect(db.withdrawalRequest.rows).toHaveLength(2);
  });

  it("limits how many statements one address can send in a day", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await submitWithdrawal(shop, statement({ order: `#${i}` }), minutes(i));
      expect(result.ok).toBe(true);
    }
    expect(await submitWithdrawal(shop, statement({ order: "#9" }), minutes(6))).toEqual({
      ok: false,
      error: "too_many",
    });
    // অন্য ঠিকানা আটকায় না, আর ২৪ ঘণ্টা পরে আবার পারা যায়
    expect((await submitWithdrawal(shop, statement({ email: "b@b.co" }), minutes(6))).ok).toBe(
      true,
    );
    expect(
      (await submitWithdrawal(shop, statement({ order: "#9" }), minutes(24 * 60 + 6))).ok,
    ).toBe(true);
  });

  it("limits how many statements a store takes in an hour", async () => {
    for (let i = 0; i < 100; i++) {
      db.withdrawalRequest.seed({
        shopId: shop.id,
        name: "x",
        email: `p${i}@b.co`,
        orderNumber: "1",
        createdAt: minutes(-30),
      });
    }
    expect(await submitWithdrawal(shop, statement(), now)).toEqual({
      ok: false,
      error: "too_many",
    });
    expect((await submitWithdrawal(shop, statement(), minutes(31))).ok).toBe(true);
  });

  it("also emails the merchant when a reply-to address is set", async () => {
    const withReplyTo = { ...shop, emailSettings: { replyTo: "owner@tom.example" } };
    await submitWithdrawal(withReplyTo, statement({ locale: "de" }), now);
    const mails = await deliver();
    expect(mails.map((mail) => mail.to)).toEqual(["anna@example.com", "owner@tom.example"]);
    const notice = mails[1];
    expect(notice?.subject).toBe("New withdrawal request for order #1001");
    expect(notice?.text).toContain(
      [
        "Name: Anna Schmidt",
        "Order: #1001",
        "Email: anna@example.com",
        "Details: The blue jacket only",
        "Received on: November 11, 2026 at 7:12 AM UTC",
      ].join("\n"),
    );
    // ক্রেতার ইমেইলে তারিখ তাঁর ভাষায়, মার্চেন্টেরটায় ইংরেজিতে; সময় একই
    expect(mails[0]?.text).toContain("11. November 2026 um 07:12 UTC");

    // তালিকায় ইমেইলের অবস্থা ক্রেতার প্রাপ্তিস্বীকারের, মার্চেন্টের খবরের নয়
    db.message.rows[1]!.status = "failed";
    expect((await listWithdrawals(shop.id)).rows[0]?.ack).toBe("sent");
  });

  it("sends no notice when the merchant set no reply-to address, or on a repeated click", async () => {
    await submitWithdrawal({ ...shop, emailSettings: { replyTo: "" } }, statement(), now);
    expect(db.message.rows).toHaveLength(1);

    const withReplyTo = { ...shop, emailSettings: { replyTo: "owner@tom.example" } };
    await submitWithdrawal(withReplyTo, statement(), minutes(1));
    expect(db.message.rows).toHaveLength(1);
  });

  it("falls back to English for an unknown or broken language", async () => {
    await submitWithdrawal(shop, statement({ locale: "xx-not a locale" }), now);
    const [mail] = await deliver();
    expect(mail?.text).toContain("Received on: November 11, 2026 at 7:12 AM UTC");
  });
});

describe("submittedText", () => {
  it("writes the date and time in UTC and says so", () => {
    expect(submittedText(new Date("2026-06-30T22:30:00Z"), "en")).toBe(
      "June 30, 2026 at 10:30 PM UTC",
    );
    expect(submittedText(new Date("2026-06-30T22:30:00Z"), "de")).toBe(
      "30. Juni 2026 um 22:30 UTC",
    );
    expect(submittedText(new Date("2026-06-30T22:30:00Z"), "not a locale")).toBe(
      "June 30, 2026 at 10:30 PM UTC",
    );
  });
});

describe("the merchant's list", () => {
  it("shows the newest first with the state of each confirmation email", async () => {
    await submitWithdrawal(shop, statement({ order: "#1" }), minutes(0));
    await submitWithdrawal(shop, statement({ order: "#2", email: "b@b.co" }), minutes(1));
    await submitWithdrawal(shop, statement({ order: "#3", email: "c@b.co" }), minutes(2));
    await deliver();
    // তৃতীয়টার ইমেইল পাঠানো যায়নি, চতুর্থটা এখনো লাইনে, পঞ্চমটার ইমেইলের রেকর্ডই নেই
    db.message.rows[2]!.status = "skipped";
    await submitWithdrawal(shop, statement({ order: "#4", email: "d@b.co" }), minutes(3));
    db.withdrawalRequest.seed({
      shopId: shop.id,
      name: "Old",
      email: "old@b.co",
      orderNumber: "#0",
      createdAt: minutes(-60),
    });

    const list = await listWithdrawals(shop.id);
    expect(list.total).toBe(5);
    expect(list.open).toBe(5);
    expect(list.rows.map((row) => [row.orderNumber, row.ack])).toEqual([
      ["#4", "queued"],
      ["#3", "failed"],
      ["#2", "sent"],
      ["#1", "sent"],
      ["#0", null],
    ]);
    expect(list.rows[0]).toMatchObject({ status: "new", createdAt: minutes(3).toISOString() });
    expect((await listWithdrawals(shop.id, 2)).rows).toHaveLength(2);
  });

  it("marks a request handled and back, only for its own store", async () => {
    const result = await submitWithdrawal(shop, statement(), now);
    const id = result.ok ? result.id : "";
    expect(await setWithdrawalStatus("other-shop", id, "handled")).toBe(false);
    expect(db.withdrawalRequest.rows[0]?.status).toBe("new");

    expect(await setWithdrawalStatus(shop.id, id, "handled")).toBe(true);
    expect((await listWithdrawals(shop.id)).open).toBe(0);
    expect(await setWithdrawalStatus(shop.id, id, "new")).toBe(true);
    expect((await listWithdrawals(shop.id)).rows[0]?.status).toBe("new");
  });

  it("returns an empty list for a store with no requests", async () => {
    expect(await listWithdrawals(shop.id)).toEqual({ total: 0, open: 0, rows: [] });
    expect(await openWithdrawals(shop.id)).toBe(0);
  });

  it("counts the requests that are still new", async () => {
    await submitWithdrawal(shop, statement({ order: "#1" }), now);
    const second = await submitWithdrawal(shop, statement({ order: "#2" }), now);
    expect(await openWithdrawals(shop.id)).toBe(2);
    await setWithdrawalStatus(shop.id, second.ok ? second.id : "", "handled");
    expect(await openWithdrawals(shop.id)).toBe(1);
  });
});
