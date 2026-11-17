import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createT } from "@app/i18n";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { resetRateLimits } = await import("./rate-limit.server");
const {
  cleanBody,
  cleanSubject,
  closeTicket,
  createTicket,
  deskShops,
  deskStats,
  deskTicket,
  deskTickets,
  deskUrl,
  helpAdminUrl,
  isDeskShop,
  listTickets,
  median,
  merchantReply,
  openTicket,
  pruneSupport,
  sendSupportEmail,
  setDeskStatus,
  supportInbox,
  supportReply,
  typicalReplyMinutes,
} = await import("./support.server");
const { answerLines, durationLabel, replyTimeLabel } = await import("./support");

const T0 = new Date("2026-11-17T10:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const days = (n: number) => minutes(n * 1440);
const t = createT("en");

const EMAIL_ENV = {
  EMAIL_FROM: "mail@send.example.org",
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_test",
};
const savedEnv = { ...process.env };

let shopId: string;
let otherShopId: string;

const input = (extra: Record<string, unknown> = {}) => ({
  email: "Owner@Shop.example",
  subject: "Reviews don't show",
  body: "The review widget is missing on product pages.",
  ...extra,
});

async function newTicket(now = T0, shop = shopId) {
  const result = await createTicket(shop, input(), now);
  if (!result.ok) throw new Error(result.error);
  return result.id;
}

const emailJobs = () => db.job.rows.filter((row) => String(row.kind).startsWith("support-email:"));

beforeEach(() => {
  resetFakeDb();
  resetRateLimits();
  Object.assign(process.env, EMAIL_ENV);
  shopId = db.shop.seed({ domain: "a.myshopify.com", plan: "starter" }).id as string;
  otherShopId = db.shop.seed({ domain: "b.myshopify.com", plan: "professional" }).id as string;
});

afterEach(() => {
  for (const key of Object.keys(EMAIL_ENV)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

describe("support text", () => {
  it("cleans messages and subjects", () => {
    expect(cleanBody("  Hi\r\n\r\n\r\n\r\nthere\u0007  ")).toBe("Hi\n\nthere");
    expect(cleanBody("   ")).toBeNull();
    expect(cleanBody("x".repeat(5001))).toBeNull();
    expect(cleanBody(42)).toBeNull();
    expect(cleanSubject("Help\nme\r\nplease ")).toBe("Help me please");
    expect(cleanSubject("x".repeat(151))).toBeNull();
  });

  it("turns the assistant's Markdown into safe parts", () => {
    const site = "https://allinone.example.app";
    const lines = answerLines(
      [
        "Open **Settings** and see [Reviews](https://allinone.example.app/help/reviews).",
        "",
        "- Not [this one](https://evil.example/phish)",
        "## Heading",
        "[Bad scheme](javascript:alert`1`)",
      ].join("\n"),
      site,
    );
    expect(lines).toEqual([
      [
        { kind: "text", text: "Open " },
        { kind: "bold", text: "Settings" },
        { kind: "text", text: " and see " },
        { kind: "link", text: "Reviews", href: "https://allinone.example.app/help/reviews" },
        { kind: "text", text: "." },
      ],
      [
        { kind: "text", text: "• Not " },
        { kind: "text", text: "this one" },
      ],
      [{ kind: "text", text: "Heading" }],
      [{ kind: "text", text: "Bad scheme" }],
    ]);
  });

  it("describes reply times and waits", () => {
    expect(replyTimeLabel(t, 25)).toBe("within an hour");
    expect(replyTimeLabel(t, 61)).toBe("within 2 hours");
    expect(replyTimeLabel(t, 26 * 60)).toBe("within 2 days");
    expect(durationLabel(t, 45.9)).toBe("45 min");
    expect(durationLabel(t, 130)).toBe("2 h");
    expect(durationLabel(t, 3 * 1440 + 5)).toBe("3 d");
  });
});

describe("merchant tickets", () => {
  it("opens a ticket with its first message and queues the email to support", async () => {
    const id = await newTicket();
    expect(db.supportTicket.rows).toHaveLength(1);
    expect(db.supportTicket.rows[0]).toMatchObject({
      id,
      shopId,
      email: "owner@shop.example",
      subject: "Reviews don't show",
      status: "open",
      lastAuthor: "merchant",
    });
    expect(db.supportMessage.rows).toEqual([
      expect.objectContaining({ ticketId: id, author: "merchant", createdAt: T0 }),
    ]);
    expect(emailJobs()).toHaveLength(1);
  });

  it("queues no email when the app can't send email", async () => {
    delete process.env.EMAIL_FROM;
    await newTicket();
    expect(emailJobs()).toHaveLength(0);
  });

  it("checks every field", async () => {
    expect(await createTicket(shopId, input({ email: "nope" }), T0)).toEqual({
      ok: false,
      error: "invalid_email",
    });
    expect(await createTicket(shopId, input({ subject: " " }), T0)).toEqual({
      ok: false,
      error: "invalid_subject",
    });
    expect(await createTicket(shopId, input({ body: "" }), T0)).toEqual({
      ok: false,
      error: "invalid_body",
    });
    expect(db.supportTicket.rows).toHaveLength(0);
  });

  it("limits open tickets and tickets a day", async () => {
    for (let i = 0; i < 5; i++) await newTicket(minutes(i));
    expect(await createTicket(shopId, input(), minutes(10))).toEqual({
      ok: false,
      error: "too_many_open",
    });
    // বন্ধ টিকিট সীমায় গোনে না, কিন্তু দিনের সীমায় গোনে
    for (const row of db.supportTicket.rows) row.status = "closed";
    for (let i = 0; i < 5; i++) await newTicket(minutes(20 + i));
    for (const row of db.supportTicket.rows) row.status = "closed";
    expect(await createTicket(shopId, input(), minutes(30))).toEqual({
      ok: false,
      error: "too_many_today",
    });
    expect((await createTicket(shopId, input(), days(1.1))).ok).toBe(true);
  });

  it("shows only the store's own tickets and marks new replies until opened", async () => {
    const id = await newTicket();
    await newTicket(T0, otherShopId);
    expect(await listTickets(shopId)).toEqual([expect.objectContaining({ id, unread: false })]);
    expect(await openTicket(otherShopId, id)).toBeNull();

    await supportReply(id, "Turn on the app embed.", minutes(30));
    expect((await listTickets(shopId))[0]).toMatchObject({ status: "answered", unread: true });

    const opened = await openTicket(shopId, id, minutes(40));
    expect(opened?.messages.map((message) => message.author)).toEqual(["merchant", "support"]);
    expect((await listTickets(shopId))[0]!.unread).toBe(false);
  });

  it("reopens a ticket when the merchant writes again", async () => {
    const id = await newTicket();
    await supportReply(id, "Fixed now.", minutes(5));
    expect(await closeTicket(shopId, id)).toBe(true);
    expect(await closeTicket(otherShopId, id)).toBe(false);
    expect(db.supportTicket.rows[0]!.status).toBe("closed");

    expect(await merchantReply(otherShopId, id, "Hi", minutes(6))).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await merchantReply(shopId, id, "  ", minutes(6))).toEqual({
      ok: false,
      error: "invalid_body",
    });
    expect(await merchantReply(shopId, id, "It broke again.", minutes(60))).toEqual({ ok: true });
    expect(db.supportTicket.rows[0]).toMatchObject({
      status: "open",
      lastAuthor: "merchant",
      lastMessageAt: minutes(60),
    });
    expect(emailJobs()).toHaveLength(3);
  });

  it("stops a ticket at 100 messages", async () => {
    const id = await newTicket();
    for (let i = 1; i < 100; i++) {
      db.supportMessage.seed({ ticketId: id, author: "merchant", body: "x", createdAt: T0 });
    }
    expect(await supportReply(id, "One more", minutes(1))).toEqual({ ok: false, error: "full" });
  });
});

describe("support desk", () => {
  it("opens only in the stores named in SUPPORT_DESK_SHOPS", () => {
    const env = {
      SUPPORT_DESK_SHOPS: " Owner.myshopify.com, , bad.example.com second.myshopify.com",
    };
    expect(deskShops(env)).toEqual(["owner.myshopify.com", "second.myshopify.com"]);
    expect(isDeskShop("owner.myshopify.com", env)).toBe(true);
    expect(isDeskShop("a.myshopify.com", env)).toBe(false);
    expect(isDeskShop("a.myshopify.com", {})).toBe(false);
  });

  it("lists every store's tickets, longest waiting first", async () => {
    const first = await newTicket(minutes(0));
    const second = await newTicket(minutes(10), otherShopId);
    const third = await newTicket(minutes(20));
    await supportReply(second, "Done", minutes(30));
    expect((await deskTickets("open")).map((row) => row.id)).toEqual([first, third]);
    expect(await deskTickets("answered")).toEqual([
      expect.objectContaining({ id: second, shop: "b.myshopify.com", plan: "professional" }),
    ]);
    expect((await deskTicket(first))?.ticket.shop.domain).toBe("a.myshopify.com");
    expect(await deskTicket("missing")).toBeNull();
  });

  it("keeps the time of the first reply only", async () => {
    const id = await newTicket();
    await supportReply(id, "First", minutes(90));
    await merchantReply(shopId, id, "Thanks, one more thing", minutes(100));
    await supportReply(id, "Second", minutes(200));
    expect(db.supportTicket.rows[0]).toMatchObject({
      status: "answered",
      firstResponseAt: minutes(90),
      lastAuthor: "support",
    });
  });

  it("closes and reopens from the desk", async () => {
    const id = await newTicket();
    expect(await setDeskStatus(id, true)).toBe(true);
    expect(db.supportTicket.rows[0]!.status).toBe("closed");
    expect(await setDeskStatus(id, false)).toBe(true);
    expect(db.supportTicket.rows[0]!.status).toBe("open");
    await supportReply(id, "Answer", minutes(1));
    await setDeskStatus(id, true);
    await setDeskStatus(id, false);
    expect(db.supportTicket.rows[0]!.status).toBe("answered");
    expect(await setDeskStatus("missing", true)).toBe(false);
  });

  it("measures the typical first reply over 30 days", async () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);

    // ৫টার কম উত্তর: লক্ষ্যটা (SUPPORT_REPLY_HOURS, না থাকলে ২৪ ঘণ্টা) দেখায়
    for (const [start, reply] of [
      [0, 30],
      [1, 90],
    ]) {
      const id = await newTicket(minutes(start!));
      await supportReply(id, "Answer", minutes(start! + reply!));
    }
    expect(await typicalReplyMinutes(minutes(200), {})).toBe(24 * 60);
    expect(await typicalReplyMinutes(minutes(200), { SUPPORT_REPLY_HOURS: "8" })).toBe(480);

    // ৫টা হলে মাপা মান, লক্ষ্যের চেয়ে খারাপ হলেও
    for (const [start, reply] of [
      [2, 2000],
      [3, 3000],
      [4, 4000],
    ]) {
      const id = await newTicket(minutes(start!));
      await supportReply(id, "Answer", minutes(start! + reply!));
    }
    expect(await typicalReplyMinutes(minutes(5000), { SUPPORT_REPLY_HOURS: "8" })).toBe(2000);
    // ৩০ দিনের পুরনো টিকিট হিসাবে আসে না
    expect(await typicalReplyMinutes(days(40), {})).toBe(24 * 60);

    const stats = await deskStats(minutes(5000));
    expect(stats).toMatchObject({ waiting: 0, oldestWaitingSince: null, medianReplyMinutes: 2000 });
  });

  it("counts who is waiting and for how long", async () => {
    await newTicket(minutes(0));
    await newTicket(minutes(30), otherShopId);
    expect(await deskStats(minutes(60))).toMatchObject({
      waiting: 2,
      oldestWaitingSince: minutes(0),
      lastWeek: 2,
      medianReplyMinutes: null,
      answered: 0,
    });
  });
});

describe("support email", () => {
  const env = {
    ...EMAIL_ENV,
    SHOPIFY_API_KEY: "key123",
    SUPPORT_INBOX: "help@allinone.example.app",
    SUPPORT_DESK_SHOPS: "owner.myshopify.com",
  };
  type Mail = { to: string; subject: string; text: string; replyTo?: string; fromName: string };
  const sent: Mail[] = [];
  const send = async (mail: Mail) => {
    sent.push(mail);
    return { ok: true };
  };
  const messageIds = () => db.supportMessage.rows.map((row) => row.id as string);

  beforeEach(() => {
    sent.length = 0;
  });

  it("finds the support inbox and links", () => {
    expect(supportInbox({ SUPPORT_INBOX: " Help@AllInOne.example.app " })).toBe(
      "help@allinone.example.app",
    );
    // ব্র্যান্ডের নমুনা ঠিকানা (support@example.com) কাউকে লেখা হয় না
    expect(supportInbox({})).toBeNull();
    expect(helpAdminUrl("a.myshopify.com", "t1", env)).toBe(
      "https://admin.shopify.com/store/a/apps/key123/app/help/t1",
    );
    expect(deskUrl("t1", env)).toBe(
      "https://admin.shopify.com/store/owner/apps/key123/app/desk/t1",
    );
    expect(deskUrl("t1", { SHOPIFY_API_KEY: "key123" })).toBeNull();
  });

  it("tells support about a new ticket and about the merchant's follow-ups", async () => {
    const id = await newTicket();
    await merchantReply(shopId, id, "Still missing.", minutes(5));
    const [first, second] = messageIds();
    expect(await sendSupportEmail(first!, env, send as never)).toBe("sent");
    expect(await sendSupportEmail(second!, env, send as never)).toBe("sent");
    expect(sent[0]).toMatchObject({
      to: "help@allinone.example.app",
      subject: "New support request from a.myshopify.com: Reviews don't show",
      fromName: "AllInOne Support",
    });
    expect(sent[0]!.text).toContain("a.myshopify.com (Starter) sent a support request");
    expect(sent[0]!.text).toContain("The review widget is missing on product pages.");
    expect(sent[0]!.text).toContain("https://admin.shopify.com/store/owner/apps/key123/app/desk/");
    expect(sent[0]!.replyTo).toBeUndefined();
    expect(sent[1]!.subject).toBe("a.myshopify.com replied: Reviews don't show");
  });

  it("sends our reply to the merchant with a link back to the app", async () => {
    const id = await newTicket();
    await supportReply(id, "Turn on the app embed in your theme.", minutes(10));
    expect(await sendSupportEmail(messageIds()[1]!, env, send as never)).toBe("sent");
    expect(sent[0]).toMatchObject({
      to: "owner@shop.example",
      subject: "Re: Reviews don't show",
      replyTo: "help@allinone.example.app",
    });
    expect(sent[0]!.text).toContain("Turn on the app embed in your theme.");
    expect(sent[0]!.text).toContain(`https://admin.shopify.com/store/a/apps/key123/app/help/${id}`);
  });

  it("skips what it can't send and retries what may work later", async () => {
    await newTicket();
    const [first] = messageIds();
    expect(await sendSupportEmail(first!, { ...env, SUPPORT_INBOX: "" }, send as never)).toBe(
      "skipped",
    );
    expect(await sendSupportEmail("missing", env, send as never)).toBe("skipped");
    const permanent = async () => ({ ok: false, error: "bad address", permanent: true });
    expect(await sendSupportEmail(first!, env, permanent as never)).toBe("skipped");
    const busy = async () => ({ ok: false, error: "429 rate limited" });
    await expect(sendSupportEmail(first!, env, busy as never)).rejects.toThrow("429");
    expect(sent).toHaveLength(0);
  });
});

describe("support housekeeping", () => {
  it("closes quiet answered tickets after 14 days and deletes year-old ones", async () => {
    const answered = await newTicket(days(0));
    await supportReply(answered, "Done", days(0));
    const waiting = await newTicket(days(1));
    const old = await newTicket(days(2));
    db.supportTicket.rows.find((row) => row.id === old)!.lastMessageAt = days(-400);

    expect(await pruneSupport(days(10))).toEqual({ closed: 0, deleted: 1 });
    expect(await pruneSupport(days(15))).toEqual({ closed: 1, deleted: 0 });
    const status = Object.fromEntries(db.supportTicket.rows.map((row) => [row.id, row.status]));
    expect(status).toEqual({ [answered]: "closed", [waiting]: "open" });
  });
});
