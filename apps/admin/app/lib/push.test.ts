import { createECDH } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PushOutcome } from "./web-push.server";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));

const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { PushError, createPushCampaign, savePushSubscription, sendPushSlice, vapidKeys } =
  await import("./push.server");
const { isValidPushClick } = await import("./links.server");

process.env.SHOPIFY_API_SECRET ??= "test-secret";
process.env.SHOPIFY_APP_URL = "https://app.example.com";

let shop: { id: string; domain: string; plan: string | null };

function browserKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: Buffer.alloc(16, 3).toString("base64url"),
  };
}
const endpoint = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;

beforeEach(() => {
  resetFakeDb();
  const row = db.shop.seed({ domain: "tom.myshopify.com", plan: "professional" });
  shop = { id: row.id as string, domain: "tom.myshopify.com", plan: "professional" };
  db.toolSetting.seed({
    shopId: shop.id,
    toolId: "push-notifications",
    enabled: true,
    settings: {},
  });
});

describe("vapidKeys", () => {
  it("creates the store's keys once and keeps the private key encrypted", async () => {
    const first = await vapidKeys(shop.id);
    const second = await vapidKeys(shop.id);
    expect(second).toEqual(first);
    expect(Buffer.from(first.publicKey, "base64url")).toHaveLength(65);
    const stored = db.shop.rows[0]!.vapidPrivateKey as string;
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain(first.privateKey);
  });
});

describe("savePushSubscription", () => {
  it("stores a browser subscription once per endpoint", async () => {
    const keys = browserKeys();
    expect(await savePushSubscription(shop, { endpoint: endpoint(1), keys })).toBe("saved");
    expect(await savePushSubscription(shop, { endpoint: endpoint(1), keys })).toBe("saved");
    expect(db.pushSubscription.rows).toHaveLength(1);
  });

  it("rejects endpoints outside the known push services and malformed keys", async () => {
    const keys = browserKeys();
    expect(await savePushSubscription(shop, { endpoint: "https://internal.test/hook", keys })).toBe(
      "invalid",
    );
    expect(
      await savePushSubscription(shop, { endpoint: endpoint(1), keys: { ...keys, auth: "x" } }),
    ).toBe("invalid");
    expect(await savePushSubscription(shop, null)).toBe("invalid");
    expect(db.pushSubscription.rows).toHaveLength(0);
  });

  it("stores nothing while the tool is off", async () => {
    db.toolSetting.rows[0]!.enabled = false;
    expect(await savePushSubscription(shop, { endpoint: endpoint(1), keys: browserKeys() })).toBe(
      "disabled",
    );
  });
});

describe("createPushCampaign", () => {
  it("queues a notification and resolves store paths to full links", async () => {
    const id = await createPushCampaign(shop, {
      title: " Sale ",
      body: "20% off",
      url: "/collections/sale",
    });
    expect(db.pushCampaign.rows[0]).toMatchObject({
      id,
      title: "Sale",
      url: "https://tom.myshopify.com/collections/sale",
      status: "queued",
    });
    expect(db.job.rows).toMatchObject([{ kind: "push-send", payload: { campaignId: id } }]);
    await createPushCampaign(shop, { title: "Home", body: "", url: "" });
    expect(db.pushCampaign.rows[1]?.url).toBe("https://tom.myshopify.com");
  });

  it("refuses an empty title, an insecure link and a disabled tool", async () => {
    await expect(createPushCampaign(shop, { title: "", body: "", url: "" })).rejects.toThrow(
      PushError,
    );
    await expect(
      createPushCampaign(shop, { title: "Hi", body: "", url: "http://tom.com" }),
    ).rejects.toThrow("invalid");
    await expect(
      createPushCampaign(shop, { title: "Hi", body: "", url: "javascript:alert(1)" }),
    ).rejects.toThrow("invalid");
    db.toolSetting.rows[0]!.enabled = false;
    await expect(createPushCampaign(shop, { title: "Hi", body: "", url: "" })).rejects.toThrow(
      "tool_off",
    );
    expect(db.pushCampaign.rows).toHaveLength(0);
  });
});

describe("sendPushSlice", () => {
  it("sends to every subscriber, counts results and forgets dead subscriptions", async () => {
    for (let i = 1; i <= 3; i++) {
      await savePushSubscription(shop, { endpoint: endpoint(i), keys: browserKeys() });
    }
    const id = await createPushCampaign(shop, { title: "Sale", body: "Now", url: "/sale" });
    const payloads: string[] = [];
    const send = vi.fn(
      async (target: { endpoint: string }, payload: string): Promise<PushOutcome> => {
        payloads.push(payload);
        if (target.endpoint === endpoint(2)) return "gone";
        if (target.endpoint === endpoint(3)) throw new Error("network down");
        return "sent";
      },
    );
    expect(await sendPushSlice(id, "", send)).toEqual({ next: null });
    expect(db.pushCampaign.rows[0]).toMatchObject({ status: "sent", sent: 1, failed: 2 });
    expect(db.pushSubscription.rows.map((r) => r.endpoint)).toEqual([endpoint(1), endpoint(3)]);

    // নোটিফিকেশনের লিংক আমাদের সই করা, ক্লিক গোনার ঠিকানা
    const data = JSON.parse(payloads[0]!) as { title: string; body: string; url: string };
    expect(data).toMatchObject({ title: "Sale", body: "Now" });
    const link = new URL(data.url);
    expect(link.origin + link.pathname).toBe(`https://app.example.com/e/p/${id}`);
    expect(
      isValidPushClick(id, link.searchParams.get("u") ?? "", link.searchParams.get("s") ?? ""),
    ).toBe(true);
    expect(link.searchParams.get("u")).toBe("https://tom.myshopify.com/sale");

    // শেষ হওয়া ক্যাম্পেইন আবার চালালে কিছু যায় না
    await sendPushSlice(id, "", send);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("sends nothing after the tool is turned off", async () => {
    await savePushSubscription(shop, { endpoint: endpoint(1), keys: browserKeys() });
    const id = await createPushCampaign(shop, { title: "Sale", body: "", url: "" });
    db.toolSetting.rows[0]!.enabled = false;
    const send = vi.fn(async (): Promise<PushOutcome> => "sent");
    await sendPushSlice(id, "", send);
    expect(send).not.toHaveBeenCalled();
    expect(db.pushCampaign.rows[0]).toMatchObject({ status: "sent", sent: 0 });
  });
});
