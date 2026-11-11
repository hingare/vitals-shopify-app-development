import { describe, expect, it } from "vitest";
import { isSoldOut } from "./tools/back-in-stock";
import { readStatement } from "./tools/eu-withdrawal";
import { orderStatus, shipmentStatus } from "./tools/order-tracker";
import { keyBytes, sameKey } from "./tools/push-notifications";
import { stopRotation, wheelSlices } from "./tools/spin-wheel";
import { newGuestId, readCache, toggleItem } from "./tools/wishlist";

describe("back in stock", () => {
  it("treats only counted variants with nothing left as sold out", () => {
    const inventory = { "11": 0, "12": 4, "13": -2 };
    expect(isSoldOut(inventory, "11")).toBe(true);
    expect(isSoldOut(inventory, "13")).toBe(true);
    expect(isSoldOut(inventory, "12")).toBe(false);
    // তালিকায় নেই = স্টক গোনা হয় না বা স্টক শেষেও বিক্রি চালু
    expect(isSoldOut(inventory, "99")).toBe(false);
    expect(isSoldOut(undefined, "11")).toBe(false);
  });
});

describe("spin the wheel", () => {
  const settings = {
    slice1: { prize: "5% off", percentOff: 5, chance: 30 },
    slice2: { prize: "No prize", percentOff: 0, chance: 50 },
    slice3: { prize: "Hidden", percentOff: 10, chance: 0 },
    slice4: { prize: "", percentOff: 10, chance: 40 },
    slice5: { prize: "20% off", percentOff: 20, chance: 20 },
  };

  it("draws each slice at the size of its real chance", () => {
    const slices = wheelSlices(settings);
    // সম্ভাবনা ০ বা লেখা ফাঁকা ঘর থাকে না; নম্বর সেটিংসের ঘরের নম্বরই থাকে
    expect(slices.map((slice) => slice.n)).toEqual([1, 2, 5]);
    expect(slices.map((slice) => Math.round(slice.end - slice.start))).toEqual([108, 180, 72]);
    expect(slices[0]?.start).toBe(0);
    expect(slices[2]?.end).toBeCloseTo(360);
  });

  it("stops with the middle of the winning slice under the pointer", () => {
    const slices = wheelSlices(settings);
    for (const slice of slices) {
      const middle = (slice.start + slice.end) / 2;
      const rotation = stopRotation(slices, slice.n);
      expect(rotation).toBeGreaterThanOrEqual(5 * 360);
      expect((middle + rotation) % 360).toBeCloseTo(0);
    }
    expect(stopRotation(slices, 3)).toBe(0);
  });

  it("has no wheel when no slice can be drawn", () => {
    expect(wheelSlices({ slice1: { prize: "x", percentOff: 5, chance: 0 } })).toEqual([]);
  });
});

describe("wishlist", () => {
  const shirt = { productId: "1", handle: "shirt" };
  const cap = { productId: "2", handle: "cap" };
  const cache = (owner: number, items: unknown[]) => JSON.stringify({ o: owner, items });

  it("adds new products to the front and removes saved ones", () => {
    expect(toggleItem([shirt], cap)).toEqual({ items: [cap, shirt], action: "add" });
    expect(toggleItem([cap, shirt], { productId: "2", handle: "renamed-cap" })).toEqual({
      items: [shirt],
      action: "remove",
    });
  });

  it("never shows one customer's saved list to someone else", () => {
    // নিজের তালিকা
    expect(readCache(cache(7, [shirt]), 7)).toEqual([shirt]);
    expect(readCache(cache(0, [shirt]), null)).toEqual([shirt]);
    // অতিথির তালিকা লগইনের পরেও থাকে (সার্ভার মিশিয়ে দেয়)
    expect(readCache(cache(0, [shirt]), 7)).toEqual([shirt]);
    // লগআউটের পরে বা অন্য ক্রেতা লগইন করলে আগের তালিকা নয়
    expect(readCache(cache(7, [shirt]), null)).toEqual([]);
    expect(readCache(cache(7, [shirt]), 8)).toEqual([]);
  });

  it("ignores a damaged cache", () => {
    expect(readCache(null, null)).toEqual([]);
    expect(readCache("{oops", null)).toEqual([]);
    expect(readCache(JSON.stringify([shirt]), null)).toEqual([]);
    expect(readCache(cache(0, [shirt, null, { productId: 5, handle: "x" }, "y"]), null)).toEqual([
      shirt,
    ]);
  });

  it("makes guest ids the server accepts", () => {
    const ids = new Set(Array.from({ length: 50 }, newGuestId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});

describe("push notifications", () => {
  it("reads the server's key and notices a changed key", () => {
    // base64url: "-" আর "_" সহ, padding ছাড়া
    expect([...keyBytes("-_8A")]).toEqual([251, 255, 0]);
    expect([...keyBytes("AQID")]).toEqual([1, 2, 3]);
    expect([...keyBytes("AQIDBA")]).toEqual([1, 2, 3, 4]);
    const key = keyBytes("AQIDBA");
    expect(sameKey(new Uint8Array([1, 2, 3, 4]).buffer, key)).toBe(true);
    expect(sameKey(new Uint8Array([1, 2, 3, 5]).buffer, key)).toBe(false);
    expect(sameKey(new Uint8Array([1, 2, 3]).buffer, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });
});

describe("order tracker", () => {
  const shipment = (status: string | null) => ({
    status,
    company: null,
    number: null,
    url: null,
    estimatedDeliveryAt: null,
    deliveredAt: null,
  });
  const order = (fulfillment: string, statuses: Array<string | null>, cancelled = false) => ({
    cancelled,
    fulfillment,
    shipments: statuses.map(shipment),
  });

  it("puts the courier's status in plain words", () => {
    expect(shipmentStatus("DELIVERED")).toBe("trackDelivered");
    expect(shipmentStatus("OUT_FOR_DELIVERY")).toBe("trackOutForDelivery");
    expect(shipmentStatus("IN_TRANSIT")).toBe("trackOnTheWay");
    // লেবেল ছাপা মানেই পার্সেল রওনা দেয়নি
    expect(shipmentStatus("LABEL_PRINTED")).toBe("trackPreparing");
    // অবস্থা জানা না থাকলে বা ব্যর্থ হলে বাড়িয়ে বলি না
    expect(shipmentStatus(null)).toBe("trackShipped");
    expect(shipmentStatus("NOT_DELIVERED")).toBe("trackShipped");
  });

  it("sums up the whole order", () => {
    expect(orderStatus(order("UNFULFILLED", []))).toBe("trackPreparing");
    expect(orderStatus(order("FULFILLED", []))).toBe("trackShipped");
    expect(orderStatus(order("FULFILLED", ["IN_TRANSIT"]))).toBe("trackOnTheWay");
    expect(orderStatus(order("FULFILLED", ["DELIVERED", "DELIVERED"]))).toBe("trackDelivered");
    // দুই পার্সেলের অবস্থা আলাদা হলে "delivered" বলা যায় না
    expect(orderStatus(order("FULFILLED", ["DELIVERED", "IN_TRANSIT"]))).toBe("trackShipped");
    expect(orderStatus(order("PARTIALLY_FULFILLED", ["DELIVERED"]))).toBe("trackPartlyShipped");
    expect(orderStatus(order("IN_PROGRESS", ["IN_TRANSIT"]))).toBe("trackPartlyShipped");
    expect(orderStatus(order("FULFILLED", ["DELIVERED"], true))).toBe("trackCancelled");
  });
});

describe("eu withdrawal", () => {
  it("reads the statement from the form, trimmed, with empty details when left out", () => {
    const form = new Map<string, unknown>([
      ["name", "  Anna Schmidt "],
      ["order", " #1001"],
      ["email", "anna@example.com "],
    ]);
    expect(readStatement(form)).toEqual({
      name: "Anna Schmidt",
      order: "#1001",
      email: "anna@example.com",
      details: "",
    });
  });
});
