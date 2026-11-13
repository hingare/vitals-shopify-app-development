import { IntegrationError } from "@app/integrations";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
// বাইরের সার্ভিসে আসল অনুরোধ যায় না: Klaviyo-র adapter নকল
const klaviyo = vi.hoisted(() => ({
  id: "klaviyo",
  hasLists: true,
  validate: vi.fn<(apiKey: string) => Promise<void>>(async () => undefined),
  lists: vi.fn(async () => [{ id: "L1", name: "Newsletter" }]),
  subscribe: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  unsubscribe: vi.fn(async (): Promise<void> => undefined),
  event: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock("@app/integrations", async (original) => {
  const real = await original<typeof import("@app/integrations")>();
  return {
    ...real,
    EMAIL_TOOLS: { ...real.EMAIL_TOOLS, klaviyo },
  };
});

const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { readSecretJson } = await import("./crypto.server");
const {
  SKIP_LIST,
  connectEmailTool,
  listFor,
  listIntegrations,
  queueContactSync,
  queueEvent,
  readEspConfig,
  runEspSync,
  saveEspConfig,
} = await import("./integrations.server");

const shopId = "shop1";
const contact = { email: "a@b.com", source: "spin-wheel" };

beforeEach(() => {
  resetFakeDb();
  for (const fn of Object.values(klaviyo)) {
    if (typeof fn === "function") fn.mockClear();
  }
  klaviyo.subscribe.mockResolvedValue(undefined);
  klaviyo.validate.mockResolvedValue(undefined);
});

describe("list mapping", () => {
  it("sends each source to its own list, the default list, or nowhere", () => {
    const config = readEspConfig({
      defaultList: "MAIN",
      lists: { "spin-wheel": "WHEEL", popup: SKIP_LIST, "back-in-stock": "", unknown: "X" },
    });
    expect(config.lists).toEqual({ "spin-wheel": "WHEEL", popup: SKIP_LIST, "back-in-stock": "" });
    expect(listFor(config, "spin-wheel")).toEqual({ skip: false, listId: "WHEEL" });
    expect(listFor(config, "back-in-stock")).toEqual({ skip: false, listId: "MAIN" });
    expect(listFor(config, "shopify")).toEqual({ skip: false, listId: "MAIN" });
    expect(listFor(config, "popup")).toEqual({ skip: true, listId: null });
    expect(listFor(readEspConfig(null), "popup")).toEqual({ skip: false, listId: null });
  });
});

describe("connecting an email tool", () => {
  it("checks the key with the provider and stores it encrypted", async () => {
    await connectEmailTool(shopId, "klaviyo", "  pk_live_123456  ");
    expect(klaviyo.validate).toHaveBeenCalledWith("pk_live_123456");
    const row = db.integration.rows[0] as { secret: string };
    expect(row.secret).not.toContain("pk_live_123456");
    expect(readSecretJson<{ apiKey: string }>(row.secret)?.apiKey).toBe("pk_live_123456");
  });

  it("stores nothing when the provider rejects the key", async () => {
    klaviyo.validate.mockRejectedValue(new IntegrationError("Invalid API key", 401, false));
    await expect(connectEmailTool(shopId, "klaviyo", "pk_wrong_key")).rejects.toThrow(
      "Invalid API key",
    );
    await expect(connectEmailTool(shopId, "klaviyo", "short")).rejects.toThrow("Enter the API key");
    expect(db.integration.rows).toHaveLength(0);
  });

  it("never sends the key back to the admin page, only the last 4 characters", async () => {
    await connectEmailTool(shopId, "klaviyo", "pk_live_123456");
    const [shown] = await listIntegrations(shopId);
    expect(shown).toMatchObject({ provider: "klaviyo", status: "connected", keyHint: "••••3456" });
    expect(JSON.stringify(shown)).not.toContain("pk_live_123456");
  });
});

describe("sync jobs", () => {
  beforeEach(async () => {
    await connectEmailTool(shopId, "klaviyo", "pk_live_123456");
  });

  it("queues one job per connected email tool, and none for any other saved connection", async () => {
    db.integration.seed({ shopId, provider: "something-else", secret: "x" });
    await queueContactSync(shopId, contact);
    await queueEvent(shopId, "spin-wheel", { email: "a@b.com", name: "Spin won" });
    expect(
      db.job.rows.map((j) => [
        (j.payload as { provider: string }).provider,
        (j.payload as { action: string }).action,
      ]),
    ).toEqual([
      ["klaviyo", "subscribe"],
      ["klaviyo", "event"],
    ]);
  });

  it("sends the contact to the list chosen for its source and records the sync time", async () => {
    await saveEspConfig(shopId, "klaviyo", {
      defaultList: "MAIN",
      lists: { "spin-wheel": "WHEEL" },
    });
    await runEspSync(shopId, { provider: "klaviyo", action: "subscribe", contact });
    expect(klaviyo.subscribe).toHaveBeenCalledWith("pk_live_123456", "WHEEL", contact);
    expect(db.integration.rows[0]).toMatchObject({ status: "connected", lastError: null });
    expect(db.integration.rows[0]?.lastSyncAt).toBeInstanceOf(Date);
  });

  it("sends nothing from a source the merchant switched off", async () => {
    await saveEspConfig(shopId, "klaviyo", { lists: { "spin-wheel": SKIP_LIST } });
    await runEspSync(shopId, { provider: "klaviyo", action: "subscribe", contact });
    expect(klaviyo.subscribe).not.toHaveBeenCalled();
  });

  it("shows a wrong key on the Integrations page and does not retry it", async () => {
    klaviyo.subscribe.mockRejectedValue(new IntegrationError("Invalid API key", 401, false));
    await runEspSync(shopId, { provider: "klaviyo", action: "subscribe", contact });
    expect(db.integration.rows[0]).toMatchObject({ status: "error", lastError: "Invalid API key" });
  });

  it("retries a rate limit or network problem", async () => {
    klaviyo.subscribe.mockRejectedValue(new IntegrationError("Rate limited", 429, true));
    await expect(
      runEspSync(shopId, { provider: "klaviyo", action: "subscribe", contact }),
    ).rejects.toThrow("Rate limited");
    klaviyo.subscribe.mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      runEspSync(shopId, { provider: "klaviyo", action: "subscribe", contact }),
    ).rejects.toThrow("ECONNRESET");
    expect(db.integration.rows[0]?.status).toBe("error");
  });

  it("quietly drops jobs for a tool that was disconnected meanwhile", async () => {
    db.integration.reset();
    await runEspSync(shopId, { provider: "klaviyo", action: "subscribe", contact });
    await runEspSync(shopId, { provider: "not-a-tool", action: "subscribe", contact });
    expect(klaviyo.subscribe).not.toHaveBeenCalled();
  });
});
