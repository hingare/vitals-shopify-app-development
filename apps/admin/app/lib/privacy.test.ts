import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));

const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { customerData, hasCustomerData, redactCustomer } = await import("./privacy.server");

const ANNA = "anna@example.com";
const BOB = "bob@example.com";
let shopA: string;
let shopB: string;

/** এক স্টোরে এক ক্রেতার সব রকম তথ্য বসায় */
function seedCustomer(shopId: string, email: string, customerId: string, name: string) {
  db.subscriber.seed({
    shopId,
    email,
    firstName: name,
    customerId,
  });
  db.message.seed({
    shopId,
    channel: "email",
    kind: "campaign",
    refId: "camp1",
    recipient: email,
    dedupeKey: `campaign:camp1:${email}`,
    status: "sent",
    sentAt: new Date("2026-11-01T10:00:00Z"),
    payload: { content: { subject: "Autumn sale" }, vars: { name } },
  });
  db.message.seed({
    shopId,
    channel: "email",
    kind: "flow",
    refId: "winback",
    recipient: email,
    dedupeKey: `flow:winback:${email}`,
    status: "queued",
    payload: { content: { subject: "We miss you" }, vars: { name } },
  });
  db.review.seed({
    shopId,
    productId: "101",
    rating: 5,
    body: "Great jacket",
    authorName: name,
    authorEmail: email,
    status: "published",
  });
  db.abandonedCheckout.seed({
    shopId,
    token: `tok-${email}`,
    email,
    firstName: name,
    recoveryUrl: "https://shop.example/recover/abc",
    total: "49.90",
    currency: "EUR",
  });
  db.stockAlert.seed({ shopId, productId: "101", variantId: "11", email });
  db.wheelSpin.seed({ shopId, email, slice: 1, label: "10% off", code: "SPIN-ABCD" });
  const request = db.withdrawalRequest.seed({
    shopId,
    name,
    email,
    orderNumber: "#1001",
    details: "The blue jacket",
  });
  db.message.seed({
    shopId,
    channel: "email",
    kind: "withdrawal",
    refId: request.id,
    recipient: email,
    dedupeKey: `withdrawal:${String(request.id)}`,
    status: "sent",
    payload: { content: { subject: "We received your withdrawal" }, vars: { name, email } },
  });
  // মার্চেন্টকে পাঠানো খবর: ঠিকানা মার্চেন্টের, কিন্তু ভেতরে ক্রেতার তথ্য
  db.message.seed({
    shopId,
    channel: "email",
    kind: "withdrawal",
    refId: `notice:${String(request.id)}`,
    recipient: "owner@shop.example",
    dedupeKey: `withdrawal-notice:${String(request.id)}`,
    status: "sent",
    payload: { content: { subject: "New withdrawal request" }, vars: { name, email } },
  });
  db.wishlistItem.seed({ shopId, owner: `c:${customerId}`, productId: "101", handle: "jacket" });
  // সম্মতি Shopify আর ইমেইল টুলে পাঠানোর কাজ: শেষ হওয়ার পরেও সারিতে ঠিকানা থাকে
  db.job.seed({
    shopId,
    kind: "shopify-consent",
    status: "done",
    payload: { email, firstName: name, state: "SUBSCRIBED" },
  });
  db.job.seed({
    shopId,
    kind: "esp-sync",
    status: "done",
    payload: { provider: "klaviyo", action: "subscribe", contact: { email, firstName: name } },
  });
  db.job.seed({
    shopId,
    kind: "esp-sync",
    payload: { provider: "klaviyo", action: "event", event: { email, name: "Spin won" } },
  });
}

/** এক স্টোরের সব সারি একসাথে লেখা হিসেবে (কোথাও ক্রেতার তথ্য রয়ে গেল কিনা খুঁজতে) */
const everythingOf = (shopId: string) =>
  JSON.stringify(
    Object.values(db).flatMap((table) => table.rows.filter((row) => row.shopId === shopId)),
  );

beforeEach(() => {
  resetFakeDb();
  shopA = db.shop.seed({ domain: "a.myshopify.com" }).id as string;
  shopB = db.shop.seed({ domain: "b.myshopify.com" }).id as string;
  seedCustomer(shopA, ANNA, "77", "Anna Schmidt");
  seedCustomer(shopA, BOB, "88", "Bob Stone");
  seedCustomer(shopB, ANNA, "55", "Anna Schmidt");
  db.wishlistItem.seed({
    shopId: shopA,
    owner: "g:guest-0123456789abcdef",
    productId: "9",
    handle: "cap",
  });
});

describe("customerData", () => {
  it("collects everything held about one customer of one store", async () => {
    const data = await customerData(shopA, { email: " Anna@Example.com ", customerId: 77 });
    expect(data.customer).toEqual({ emails: [ANNA], customerId: "77" });
    expect(data.subscriber).toMatchObject([
      { email: ANNA, firstName: "Anna Schmidt", status: "subscribed" },
    ]);
    expect(data.emails.map((mail) => mail.subject).sort()).toEqual([
      "Autumn sale",
      "We miss you",
      "We received your withdrawal",
    ]);
    expect(data.reviews).toMatchObject([{ body: "Great jacket", name: "Anna Schmidt", rating: 5 }]);
    expect(data.abandonedCheckouts).toMatchObject([{ total: "49.90", currency: "EUR" }]);
    expect(data.stockAlerts).toMatchObject([{ productId: "101", variantId: "11" }]);
    expect(data.wheelSpins).toMatchObject([{ prize: "10% off", code: "SPIN-ABCD" }]);
    expect(data.withdrawals).toMatchObject([{ orderNumber: "#1001", details: "The blue jacket" }]);
    expect(data.wishlist).toMatchObject([{ productId: "101", handle: "jacket" }]);
    expect(hasCustomerData(data)).toBe(true);
    // অন্য ক্রেতার বা অন্য স্টোরের কিছু নয়
    expect(JSON.stringify(data)).not.toContain("bob@");
    expect(JSON.stringify(data)).not.toContain("Bob");
  });

  it("finds a customer by Shopify id even after they changed their email", async () => {
    const data = await customerData(shopA, { email: "anna.new@example.com", customerId: "77" });
    expect(data.customer.emails.sort()).toEqual(["anna.new@example.com", ANNA]);
    expect(data.subscriber).toHaveLength(1);
    expect(data.reviews).toHaveLength(1);
  });

  it("includes the wishlist when only the email is given and our list knows the Shopify id", async () => {
    // মার্চেন্ট Subscribers পেজে শুধু ইমেইল দিয়ে খোঁজেন; wishlist রাখা customer id-তে
    const data = await customerData(shopA, { email: ANNA });
    expect(data.customer).toEqual({ emails: [ANNA], customerId: "77" });
    expect(data.wishlist).toMatchObject([{ productId: "101", handle: "jacket" }]);
    expect(JSON.stringify(data)).not.toContain("Bob");
  });

  it("returns nothing for an unknown or unusable customer", async () => {
    for (const ref of [{ email: "nobody@example.com" }, { email: "not an email" }, {}]) {
      const data = await customerData(shopA, ref);
      expect(hasCustomerData(data)).toBe(false);
    }
  });
});

describe("redactCustomer", () => {
  it("leaves no trace of the customer in that store", async () => {
    const counts = await redactCustomer(shopA, { email: ANNA, customerId: 77 });
    // মোছা: গ্রাহক, চেকআউট, অপেক্ষার অনুরোধ, চাকা, বিবৃতি, wishlist, লাইনে থাকা ইমেইল, আর ৩টা ব্যাকগ্রাউন্ড কাজ
    expect(counts.deleted).toBe(10);
    // বেনামী: পাঠানো ৩টা ইমেইল (ক্যাম্পেইন, প্রাপ্তিস্বীকার, মার্চেন্টের খবর) আর রিভিউ
    expect(counts.anonymized).toBe(4);

    const left = everythingOf(shopA);
    expect(left).not.toContain("anna@");
    expect(left).not.toContain("Anna");
    expect(hasCustomerData(await customerData(shopA, { email: ANNA, customerId: 77 }))).toBe(false);
  });

  it("keeps the sent emails as numbers only and never sends the queued one", async () => {
    await redactCustomer(shopA, { email: ANNA });
    const mine = db.message.rows.filter((row) => row.shopId === shopA && row.refId !== "camp1");
    expect(mine.some((row) => row.refId === "winback" && row.recipient !== BOB)).toBe(false);
    const campaign = db.message.rows.filter(
      (row) => row.shopId === shopA && row.refId === "camp1" && row.recipient === "redacted",
    );
    // ক্যাম্পেইনের হিসাবে সারিটা থাকে, তথ্য ছাড়া
    expect(campaign).toHaveLength(1);
    expect(campaign[0]).toMatchObject({ status: "sent", payload: {}, dedupeKey: null });
  });

  it("removes the wishlist too when only the email is given", async () => {
    await redactCustomer(shopA, { email: ANNA });
    const owners = db.wishlistItem.rows
      .filter((row) => row.shopId === shopA)
      .map((row) => row.owner);
    expect(owners.sort()).toEqual(["c:88", "g:guest-0123456789abcdef"]);
  });

  it("keeps the review but without the name and email", async () => {
    await redactCustomer(shopA, { email: ANNA });
    const review = db.review.rows.find((row) => row.shopId === shopA && row.authorEmail === null);
    expect(review).toMatchObject({ body: "Great jacket", authorName: "Customer", rating: 5 });
  });

  it("does not touch other customers, guests or other stores", async () => {
    const bobBefore = JSON.stringify(await customerData(shopA, { email: BOB, customerId: 88 }));
    const otherStore = everythingOf(shopB);
    await redactCustomer(shopA, { email: ANNA, customerId: 77 });
    expect(JSON.stringify(await customerData(shopA, { email: BOB, customerId: 88 }))).toBe(
      bobBefore,
    );
    expect(everythingOf(shopB)).toBe(otherStore);
    expect(db.wishlistItem.rows.some((row) => row.owner === "g:guest-0123456789abcdef")).toBe(true);
    // অন্য ক্রেতার আর অন্য ধরনের কাজ থাকে
    expect(db.job.rows.filter((row) => row.shopId === shopA)).toHaveLength(3);
  });

  it("redacts by Shopify id when the email on file is an older one", async () => {
    await redactCustomer(shopA, { email: "anna.new@example.com", customerId: 77 });
    expect(everythingOf(shopA)).not.toContain("anna@");
  });

  it("is safe to run twice and does nothing without a usable customer", async () => {
    await redactCustomer(shopA, { email: ANNA, customerId: 77 });
    expect(await redactCustomer(shopA, { email: ANNA, customerId: 77 })).toEqual({
      deleted: 0,
      anonymized: 0,
    });
    const before = everythingOf(shopA);
    expect(await redactCustomer(shopA, { email: "", customerId: null })).toEqual({
      deleted: 0,
      anonymized: 0,
    });
    expect(everythingOf(shopA)).toBe(before);
  });
});
