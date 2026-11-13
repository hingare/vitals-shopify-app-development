import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));

const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { changeWishlist, listWishlist, mergeGuestList, ownerKeys, sendWishlistEvent } =
  await import("./wishlist.server");

const guest = "g:abcdefghij0123456789";
const customer = "c:42";
let shopId: string;

beforeEach(() => {
  resetFakeDb();
  shopId = db.shop.seed({ domain: "tom.myshopify.com", plan: "professional" }).id as string;
});

describe("ownerKeys", () => {
  it("accepts a numeric customer id and a random guest id, nothing else", () => {
    expect(ownerKeys("42", "abcdefghij0123456789")).toEqual({ customer: customer, guest: guest });
    expect(ownerKeys("", "short")).toEqual({ customer: null, guest: null });
    expect(ownerKeys("42 or 1=1", { $ne: "" })).toEqual({ customer: null, guest: null });
    expect(ownerKeys(null, "c:42")).toEqual({ customer: null, guest: null });
  });
});

describe("changeWishlist", () => {
  it("adds a product once and removes it again", async () => {
    const shirt = { productId: 77, handle: "blue-shirt" };
    expect(await changeWishlist(shopId, guest, "add", shirt)).toBe("added");
    expect(await changeWishlist(shopId, guest, "add", shirt)).toBe("exists");
    expect(await listWishlist(shopId, guest)).toEqual([{ productId: "77", handle: "blue-shirt" }]);
    expect(await changeWishlist(shopId, guest, "remove", shirt)).toBe("removed");
    expect(await changeWishlist(shopId, guest, "remove", shirt)).toBe("missing");
    expect(await listWishlist(shopId, guest)).toEqual([]);
  });

  it("rejects bad ids, handles and actions", async () => {
    expect(await changeWishlist(shopId, guest, "add", { productId: "x", handle: "a" })).toBe(
      "invalid",
    );
    expect(await changeWishlist(shopId, guest, "add", { productId: "1", handle: "a/b" })).toBe(
      "invalid",
    );
    expect(await changeWishlist(shopId, guest, "add", { productId: "1", handle: 5 })).toBe(
      "invalid",
    );
    expect(await changeWishlist(shopId, guest, "drop", { productId: "1", handle: "a" })).toBe(
      "invalid",
    );
    expect(db.wishlistItem.rows).toHaveLength(0);
  });

  it("keeps each owner's list apart and caps its size", async () => {
    await changeWishlist(shopId, guest, "add", { productId: "1", handle: "a" });
    expect(await listWishlist(shopId, customer)).toEqual([]);
    for (let i = 0; i < 200; i++) {
      db.wishlistItem.seed({ shopId, owner: customer, productId: String(1000 + i), handle: "p" });
    }
    expect(await changeWishlist(shopId, customer, "add", { productId: "5", handle: "a" })).toBe(
      "full",
    );
  });
});

describe("mergeGuestList", () => {
  it("moves a guest's items to the customer without duplicates", async () => {
    await changeWishlist(shopId, guest, "add", { productId: "1", handle: "a" });
    await changeWishlist(shopId, guest, "add", { productId: "2", handle: "b" });
    await changeWishlist(shopId, customer, "add", { productId: "2", handle: "b" });
    await mergeGuestList(shopId, guest, customer);
    expect((await listWishlist(shopId, customer)).map((i) => i.productId).sort()).toEqual([
      "1",
      "2",
    ]);
    expect(await listWishlist(shopId, guest)).toEqual([]);
  });
});

describe("sendWishlistEvent", () => {
  const admin = () => ({
    graphql: vi.fn<(query: string) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            data: { customer: { defaultEmailAddress: { emailAddress: "Rahim@Example.com" } } },
          }),
        ),
    ),
  });

  it("asks Shopify for nothing when no email tool is connected", async () => {
    const client = admin();
    await sendWishlistEvent(client, shopId, "42", { productId: "1", handle: "a" });
    expect(client.graphql).not.toHaveBeenCalled();
    expect(db.job.rows).toHaveLength(0);
  });

  it("queues the event for a logged-in customer", async () => {
    db.integration.seed({ shopId, provider: "omnisend", secret: "x" });
    await sendWishlistEvent(admin(), shopId, "42", { productId: "1", handle: "a" });
    expect(db.job.rows).toMatchObject([
      {
        kind: "esp-sync",
        payload: {
          provider: "omnisend",
          action: "event",
          event: {
            email: "rahim@example.com",
            name: "Wishlist added",
            properties: { productId: "1", handle: "a" },
          },
        },
      },
    ]);
  });
});
