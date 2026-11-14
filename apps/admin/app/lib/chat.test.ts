import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
process.env.SHOPIFY_API_KEY = "test-api-key";
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const {
  cleanMessage,
  cleanPath,
  hashKey,
  isOnline,
  listConversations,
  markPresence,
  merchantReply,
  openConversation,
  pruneChats,
  sendAlert,
  sendReplyEmail,
  setConversationStatus,
  unreadTotal,
  visitorSend,
  visitorThread,
} = await import("./chat.server");
const { customerData, redactCustomer } = await import("./privacy.server");

const KEY = "k".repeat(40);
const VISITOR = hashKey(KEY)!;
const T0 = new Date("2026-11-14T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

type Shop = { id: string; domain: string; plan: string; chatSeenAt: Date | null };
let shop: Shop;

const enable = (settings: Record<string, unknown> = {}) =>
  db.toolSetting.seed({ shopId: shop.id, toolId: "live-chat", enabled: true, settings });
const send = (text: string, extra: Record<string, unknown> = {}, now = T0, askEmail = "never") =>
  visitorSend(
    shop,
    { askEmail: askEmail as "never" | "offline" | "always" },
    { visitorKey: VISITOR, text, ...extra },
    now,
  );
const conversation = () => db.chatConversation.rows[0]!;
const emails = () => db.message.rows.filter((row) => row.kind === "chat");

beforeEach(() => {
  resetFakeDb();
  const row = db.shop.seed({
    domain: "a.myshopify.com",
    plan: "professional",
    emailSettings: { replyTo: "owner@shop.example" },
  });
  shop = {
    id: row.id as string,
    domain: "a.myshopify.com",
    plan: "professional",
    chatSeenAt: null,
  };
});

describe("chat input", () => {
  it("keeps only a well-formed secret, and stores just its hash", () => {
    expect(VISITOR).toMatch(/^[0-9a-f]{64}$/);
    expect(VISITOR).not.toContain(KEY);
    expect(hashKey("short")).toBeNull();
    expect(hashKey(`${"a".repeat(40)}/../`)).toBeNull();
    expect(hashKey(42)).toBeNull();
  });

  it("cleans message text and page paths", () => {
    expect(cleanMessage("  Hi\r\nthere\u0007\n\n\n\nok  ")).toBe("Hi\nthere\n\nok");
    expect(cleanMessage("   ")).toBeNull();
    expect(cleanMessage("x".repeat(1001))).toBeNull();
    expect(cleanPath("/products/linen?variant=1#top")).toBe("/products/linen");
    expect(cleanPath("https://evil.example/x")).toBeNull();
    expect(cleanPath("//evil.example")).toBeNull();
  });
});

describe("shopper side", () => {
  it("starts a conversation on the first message and counts unread ones", async () => {
    const first = await send("Do you ship to Canada?", {
      page: "/products/linen?x=1",
      locale: "fr",
    });
    expect(first).toMatchObject({ ok: true, online: false, message: { from: "visitor" } });
    expect(conversation()).toMatchObject({
      visitorKey: VISITOR,
      unread: 1,
      preview: "Do you ship to Canada?",
      lastAuthor: "visitor",
      pagePath: "/products/linen",
      locale: "fr",
    });
    await send("And to the US?", {}, at(5));
    expect(db.chatConversation.rows).toHaveLength(1);
    expect(conversation().unread).toBe(2);
    expect(db.chatMessage.rows).toHaveLength(2);
  });

  it("asks for an email only when the settings say so", async () => {
    expect(await send("Hi", {}, T0, "offline")).toEqual({ ok: false, error: "email_required" });
    expect(await send("Hi", { email: "nope" }, T0, "offline")).toEqual({
      ok: false,
      error: "invalid_email",
    });
    expect(await send("Hi", { email: "Anna@Example.com" }, T0, "offline")).toMatchObject({
      ok: true,
    });
    expect(conversation().email).toBe("anna@example.com");
    // ইমেইল একবার দিলেই হয়
    expect(await send("Still there?", {}, at(10), "always")).toMatchObject({ ok: true });

    resetFakeDb();
    shop.id = db.shop.seed({ domain: shop.domain }).id as string;
    shop.chatSeenAt = T0;
    // মার্চেন্ট অনলাইন থাকলে "offline" নিয়মে ইমেইল লাগে না, "always" নিয়মে লাগে
    expect(await send("Hi", {}, T0, "offline")).toMatchObject({ ok: true, online: true });
    resetFakeDb();
    shop.id = db.shop.seed({ domain: shop.domain }).id as string;
    expect(await send("Hi", {}, T0, "always")).toEqual({ ok: false, error: "email_required" });
    // "never" হলে দেওয়া ইমেইলও রাখা হয় না
    expect(await send("Hi", { email: "anna@example.com" }, T0, "never")).toMatchObject({
      ok: true,
    });
    expect(conversation().email).toBeNull();
  });

  it("alerts the merchant later only when they are away", async () => {
    await send("Hello?");
    await send("Anyone?", {}, at(3));
    expect(db.job.rows.map((job) => job.kind)).toEqual([`chat-alert:${conversation().id}`]);
    expect(db.job.rows[0]?.runAt).toEqual(at(60));

    resetFakeDb();
    shop.id = db.shop.seed({ domain: shop.domain }).id as string;
    shop.chatSeenAt = at(-30);
    await send("Hello?");
    expect(db.job.rows).toHaveLength(0);
  });

  it("reads only its own conversation, oldest first, and notes when the shopper looks", async () => {
    expect(await visitorThread(shop, VISITOR)).toEqual({
      online: false,
      messages: [],
      hasEmail: false,
    });
    await send("First", {}, T0);
    await merchantReply(shop.id, conversation().id as string, "Hi! Yes we do.", at(30));
    await send("Thanks", {}, at(60));
    const all = await visitorThread(shop, VISITOR, {}, at(61));
    expect(all.messages.map((message) => [message.from, message.body])).toEqual([
      ["visitor", "First"],
      ["store", "Hi! Yes we do."],
      ["visitor", "Thanks"],
    ]);
    const newer = await visitorThread(shop, VISITOR, { since: at(30) }, at(61));
    expect(newer.messages.map((message) => message.body)).toEqual(["Hi! Yes we do.", "Thanks"]);
    expect(await visitorThread(shop, hashKey("z".repeat(40)))).toMatchObject({ messages: [] });
    expect(conversation().visitorSeenAt).toBeNull();
    await visitorThread(shop, VISITOR, { open: true }, at(62));
    expect(conversation().visitorSeenAt).toEqual(at(62));
  });
});

describe("merchant side", () => {
  it("lists chats by status, marks them read when opened, and reopens on reply", async () => {
    await send("Question");
    const id = conversation().id as string;
    expect(await unreadTotal(shop.id)).toBe(1);
    expect((await listConversations(shop.id, "open")).map((row) => row.id)).toEqual([id]);

    const opened = await openConversation(shop.id, id);
    expect(opened?.messages.map((message) => message.body)).toEqual(["Question"]);
    expect(await unreadTotal(shop.id)).toBe(0);
    expect(await openConversation("someone-else", id)).toBeNull();

    expect(await setConversationStatus(shop.id, id, "closed")).toBe(true);
    expect(await listConversations(shop.id, "open")).toHaveLength(0);
    expect(await listConversations(shop.id, "closed")).toHaveLength(1);
    expect(await setConversationStatus("someone-else", id, "open")).toBe(false);

    expect(await merchantReply(shop.id, id, "  ", T0)).toEqual({ ok: false, error: "invalid" });
    expect(await merchantReply("someone-else", id, "Hi", T0)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await merchantReply(shop.id, id, "Here to help!", at(10))).toEqual({ ok: true });
    expect(conversation()).toMatchObject({
      status: "open",
      lastAuthor: "merchant",
      preview: "Here to help!",
    });
    // ইমেইল দেননি, তাই উত্তরের ইমেইলের কাজ লাইনে পড়ে না
    expect(db.job.rows.some((job) => String(job.kind).startsWith("chat-reply:"))).toBe(false);
  });

  it("shows the merchant online only while the Chat page is open, writing rarely", async () => {
    await markPresence(shop.id, T0);
    expect(db.shop.rows[0]?.chatSeenAt).toEqual(T0);
    await markPresence(shop.id, at(10));
    expect(db.shop.rows[0]?.chatSeenAt).toEqual(T0);
    await markPresence(shop.id, at(40));
    expect(db.shop.rows[0]?.chatSeenAt).toEqual(at(40));
    expect(isOnline(at(40), at(100))).toBe(true);
    expect(isOnline(at(40), at(131))).toBe(false);
    expect(isOnline(null)).toBe(false);
  });
});

describe("chat emails", () => {
  it("emails the shopper only the replies they haven't seen, once", async () => {
    enable();
    await send("Do you ship to Canada?", { email: "anna@example.com" }, T0, "offline");
    const id = conversation().id as string;
    await merchantReply(shop.id, id, "Yes, in 5 days.", at(60));
    await merchantReply(shop.id, id, "Free over $50.", at(70));
    expect(db.job.rows.filter((job) => job.kind === `chat-reply:${id}`)).toHaveLength(1);

    expect(await sendReplyEmail(id)).toBe(true);
    expect(emails()).toHaveLength(1);
    expect(emails()[0]).toMatchObject({
      recipient: "anna@example.com",
      refId: `reply:${id}`,
      payload: {
        marketing: false,
        vars: { messages: "Yes, in 5 days.\n\nFree over $50." },
        content: { buttonUrl: "https://a.myshopify.com/?app_chat=open" },
      },
    });
    expect(await sendReplyEmail(id)).toBe(false);

    // ক্রেতা চ্যাট খুলে উত্তর দেখে ফেললে ইমেইল যায় না
    await merchantReply(shop.id, id, "Anything else?", at(120));
    await visitorThread(shop, VISITOR, { open: true }, at(130));
    expect(await sendReplyEmail(id)).toBe(false);
    expect(emails()).toHaveLength(1);
  });

  it("alerts the merchant at the reply-to address, not too often", async () => {
    enable();
    await send("Is this in stock?", { page: "/products/hat" }, T0);
    const id = conversation().id as string;

    expect(await sendAlert(id, at(60))).toEqual({ sent: true });
    expect(emails()[0]).toMatchObject({
      recipient: "owner@shop.example",
      refId: `alert:${id}`,
      payload: { vars: { page: "/products/hat", messages: "Is this in stock?" } },
    });
    expect(
      String((emails()[0]?.payload as { content: { buttonUrl: string } }).content.buttonUrl),
    ).toContain(`/app/chat?c=${id}`);

    // ১০ মিনিটের মধ্যে আরেকটা নয়: কাজটা পরে আবার চলবে
    await send("Hello?", {}, at(120));
    const soon = await sendAlert(id, at(180));
    expect(soon.sent).toBe(false);
    // আগের খবরের বার্তা লেখা হয়েছিল T0-তে, তাই আরও ৭ মিনিট
    expect(soon.retryInMs).toBe(7 * 60_000);
    expect(await sendAlert(id, at(660))).toEqual({ sent: true });
    expect(emails()[1]).toMatchObject({ payload: { vars: { messages: "Hello?" } } });

    // মার্চেন্ট পড়ে ফেললে বা অনলাইন থাকলে খবর যায় না
    await send("One more", {}, at(700));
    await openConversation(shop.id, id);
    expect(await sendAlert(id, at(2000))).toEqual({ sent: false });
  });

  it("sends no alerts without a reply-to address, with the tool off, or past the daily limit", async () => {
    await send("Hi");
    const id = conversation().id as string;
    expect(await sendAlert(id, at(60))).toEqual({ sent: false });
    enable();
    db.shop.rows[0]!.chatSeenAt = at(30);
    expect(await sendAlert(id, at(60))).toEqual({ sent: false });
    db.shop.rows[0]!.chatSeenAt = null;
    db.shop.rows[0]!.emailSettings = {};
    expect(await sendAlert(id, at(60))).toEqual({ sent: false });
    db.shop.rows[0]!.emailSettings = { replyTo: "owner@shop.example" };
    for (let i = 0; i < 50; i++) {
      db.message.seed({
        shopId: shop.id,
        channel: "email",
        kind: "chat",
        refId: `alert:other${i}`,
        recipient: "owner@shop.example",
        createdAt: at(-60),
      });
    }
    expect(await sendAlert(id, at(60))).toEqual({ sent: false });
    expect(emails()).toHaveLength(50);
  });
});

describe("chat privacy", () => {
  it("removes chats that have been quiet for 180 days", async () => {
    await send("Old question", {}, new Date("2026-01-01T00:00:00Z"));
    expect(await pruneChats(new Date("2026-06-20T00:00:00Z"))).toBe(0);
    expect(await pruneChats(new Date("2026-07-01T00:00:00Z"))).toBe(1);
    expect(db.chatConversation.rows).toHaveLength(0);
  });

  it("exports and erases a customer's chats by email or customer id", async () => {
    enable();
    await send("Where is my order?", { email: "anna@example.com" }, T0, "offline");
    const byEmail = conversation().id as string;
    expect(await sendAlert(byEmail, at(20))).toEqual({ sent: true });
    await merchantReply(shop.id, byEmail, "Checking now.", at(30));
    const other = (key: string, text: string, customerId: string | null, now: Date) =>
      visitorSend(
        shop,
        { askEmail: "never" },
        { visitorKey: hashKey(key.repeat(40))!, text, customerId },
        now,
      );
    await other("c", "Logged in question", "777", at(90));
    await other("d", "Someone else", null, at(100));

    const data = await customerData(shop.id, { email: "anna@example.com", customerId: 777 });
    expect(data.chats).toHaveLength(2);
    expect(data.chats[0]?.messages.map((message) => [message.from, message.text])).toEqual([
      ["customer", "Where is my order?"],
      ["store", "Checking now."],
    ]);

    await redactCustomer(shop.id, { email: "anna@example.com", customerId: 777 });
    expect(db.chatConversation.rows.map((row) => row.id)).not.toContain(byEmail);
    expect(db.chatConversation.rows).toHaveLength(1);
    // মার্চেন্টকে পাঠানো খবরের ইমেইলে ক্রেতার লেখা ছিল: মোছা বা নাম-ঠিকানা ছাড়া
    expect(
      db.message.rows.filter(
        (row) => row.refId === `alert:${byEmail}` && row.recipient !== "redacted",
      ),
    ).toHaveLength(0);
    expect(db.job.rows.filter((job) => String(job.kind).includes(byEmail))).toHaveLength(0);
  });
});
