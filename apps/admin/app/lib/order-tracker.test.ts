import { describe, expect, it, vi } from "vitest";
import { cleanOrderName, phoneTail, trackOrder } from "./order-tracker.server";

const node = (extra: Record<string, unknown> = {}) => ({
  name: "#1001",
  createdAt: "2026-11-01T08:00:00Z",
  cancelledAt: null,
  displayFinancialStatus: "PENDING",
  displayFulfillmentStatus: "FULFILLED",
  email: "Rahim@Example.com",
  phone: null,
  shippingAddress: { phone: "+880 1712-345678" },
  billingAddress: null,
  currentTotalPriceSet: { presentmentMoney: { amount: "1250.0", currencyCode: "BDT" } },
  lineItems: { nodes: [{ title: "Blue Shirt", quantity: 2 }] },
  fulfillments: [
    {
      status: "SUCCESS",
      displayStatus: "IN_TRANSIT",
      estimatedDeliveryAt: null,
      deliveredAt: null,
      trackingInfo: [{ company: "Pathao", number: "PT123", url: "https://pathao.test/t/PT123" }],
    },
  ],
  ...extra,
});

function admin(nodes: unknown[]) {
  const graphql = vi.fn<
    (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>
  >(async () => new Response(JSON.stringify({ data: { orders: { nodes } } })));
  return { graphql };
}

describe("cleanOrderName", () => {
  it("accepts order names with or without #, and rejects search syntax", () => {
    expect(cleanOrderName(" #1001 ")).toBe("1001");
    expect(cleanOrderName("hg-1001")).toBe("HG-1001");
    expect(cleanOrderName("1001 OR name:*")).toBeNull();
    expect(cleanOrderName("")).toBeNull();
    expect(cleanOrderName(1001)).toBeNull();
  });
});

describe("phoneTail", () => {
  it("compares phone numbers by their last ten digits", () => {
    expect(phoneTail("+880 1712-345678")).toBe("1712345678");
    expect(phoneTail("01712345678")).toBe("1712345678");
    expect(phoneTail("12345")).toBeNull();
  });
});

describe("trackOrder", () => {
  it("returns the status when the order number and email match", async () => {
    const client = admin([node()]);
    const order = await trackOrder(client, { order: "#1001", contact: " rahim@example.com " });
    expect(client.graphql.mock.calls[0]?.[1]).toEqual({ variables: { query: "name:1001" } });
    expect(order).toEqual({
      name: "#1001",
      createdAt: "2026-11-01T08:00:00Z",
      cancelled: false,
      payment: "PENDING",
      fulfillment: "FULFILLED",
      total: "1250.0",
      currency: "BDT",
      items: [{ title: "Blue Shirt", quantity: 2 }],
      shipments: [
        {
          status: "IN_TRANSIT",
          company: "Pathao",
          number: "PT123",
          url: "https://pathao.test/t/PT123",
          estimatedDeliveryAt: null,
          deliveredAt: null,
        },
      ],
    });
    // ব্যক্তিগত তথ্য উত্তরে নেই
    expect(JSON.stringify(order)).not.toMatch(/example\.com|1712/);
  });

  it("matches a phone number written in a different format", async () => {
    const order = await trackOrder(admin([node()]), { order: "1001", contact: "01712345678" });
    expect(order?.name).toBe("#1001");
  });

  it("returns nothing when the contact does not belong to the order", async () => {
    expect(
      await trackOrder(admin([node()]), { order: "1001", contact: "someone@else.com" }),
    ).toBeNull();
    expect(await trackOrder(admin([node()]), { order: "1001", contact: "01800000000" })).toBeNull();
  });

  it("ignores near matches from the search and never queries with bad input", async () => {
    const near = admin([node({ name: "#10010" })]);
    expect(await trackOrder(near, { order: "1001", contact: "rahim@example.com" })).toBeNull();
    const client = admin([node()]);
    expect(await trackOrder(client, { order: "1001 OR 1", contact: "a@b.co" })).toBeNull();
    expect(await trackOrder(client, { order: "1001", contact: "" })).toBeNull();
    expect(client.graphql).not.toHaveBeenCalled();
  });

  it("leaves out shipments that were cancelled", async () => {
    const cancelled = {
      status: "CANCELLED",
      displayStatus: "CANCELED",
      estimatedDeliveryAt: null,
      deliveredAt: null,
      trackingInfo: [{ company: "Pathao", number: "OLD1", url: null }],
    };
    const order = await trackOrder(
      admin([node({ fulfillments: [cancelled, ...node().fulfillments] })]),
      { order: "1001", contact: "rahim@example.com" },
    );
    expect(order?.shipments.map((shipment) => shipment.number)).toEqual(["PT123"]);
  });

  it("drops a tracking link that is not a web address", async () => {
    const bad = node({
      fulfillments: [
        {
          status: "SUCCESS",
          displayStatus: null,
          estimatedDeliveryAt: null,
          deliveredAt: null,
          trackingInfo: [{ company: null, number: "X", url: "javascript:alert(1)" }],
        },
      ],
    });
    const order = await trackOrder(admin([bad]), { order: "1001", contact: "rahim@example.com" });
    expect(order?.shipments[0]).toMatchObject({ number: "X", url: null });
  });
});
