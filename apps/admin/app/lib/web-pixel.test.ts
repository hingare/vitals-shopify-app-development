import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const { ensurePixel, metaPixelIds, pixelSettingsJson, resetPixelRetry, syncPixel } =
  await import("./web-pixel.server");

type Variables = Record<string, unknown>;
interface Payload {
  webPixel?: { id: string } | null;
  userErrors: Array<{ code?: string; message: string }>;
}

const ENDPOINT = "https://app.example/ingest/pixel";
const PIXEL = "gid://shopify/WebPixel/1";
const ok = (id = PIXEL): Payload => ({ webPixel: { id }, userErrors: [] });
const error = (code: string): Payload => ({
  webPixel: null,
  userErrors: [{ code, message: code }],
});

/** নকল Admin API: প্রতিটা mutation-এ কী সেটিংস গেল তা মনে রাখে */
function fakeAdmin(
  respond: (name: string, settings: Record<string, string>, variables: Variables) => unknown,
) {
  const calls: Array<{ name: string; id?: string; settings: Record<string, string> }> = [];
  const graphql = vi.fn(async (query: string, options?: { variables?: Variables }) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
    const variables = options?.variables ?? {};
    const settings = variables.settings
      ? (JSON.parse(String(variables.settings)) as Record<string, string>)
      : {};
    calls.push({ name, id: variables.id as string | undefined, settings });
    const field =
      name === "CreatePixel" ? "webPixelCreate" : name === "UpdatePixel" ? "webPixelUpdate" : "";
    const result = respond(name, settings, variables);
    return new Response(JSON.stringify({ data: field ? { [field]: result } : result }));
  });
  return { graphql, calls };
}

/** extension-এর পুরোনো সংস্করণ: metaPixels চাবি চেনে না */
const oldDefinition = (_name: string, settings: Record<string, string>) =>
  "metaPixels" in settings ? error("INVALID_SETTINGS") : ok();

async function makeShop(data: Record<string, unknown> = {}) {
  return (await db.shop.create({
    data: {
      domain: "test.myshopify.com",
      plan: "professional",
      ingestKey: null,
      pixelId: null,
      pixelEndpoint: null,
      pixelSettings: null,
      uninstalledAt: null,
      ...data,
    },
  })) as unknown as {
    id: string;
    plan: string | null;
    ingestKey: string | null;
    pixelId: string | null;
    pixelEndpoint: string | null;
    pixelSettings: string | null;
  };
}

const saved = async (id: string) =>
  (await db.shop.findUnique({ where: { id } })) as unknown as Awaited<ReturnType<typeof makeShop>>;

async function enablePixels(shopId: string, settings: Record<string, string>, enabled = true) {
  await db.toolSetting.create({
    data: { shopId, toolId: "facebook-pixels", enabled, settings },
  });
}

beforeEach(() => {
  resetFakeDb();
  resetPixelRetry();
  vi.stubEnv("SHOPIFY_APP_URL", "https://app.example/");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("metaPixelIds", () => {
  it("returns the ids of an enabled tool once each", async () => {
    const shop = await makeShop();
    await enablePixels(shop.id, { pixelId1: "11111111", pixelId2: "", pixelId3: "11111111" });
    expect(await metaPixelIds(shop)).toEqual(["11111111"]);
  });

  it("returns nothing when the tool is off or the plan does not include it", async () => {
    const shop = await makeShop();
    await enablePixels(shop.id, { pixelId1: "11111111" }, false);
    expect(await metaPixelIds(shop)).toEqual([]);

    await db.toolSetting.updateMany({ where: { shopId: shop.id }, data: { enabled: true } });
    expect(await metaPixelIds(shop)).toEqual(["11111111"]);
    expect(await metaPixelIds({ id: shop.id, plan: "starter" })).toEqual([]);
    expect(await metaPixelIds({ id: shop.id, plan: null })).toEqual([]);
  });
});

describe("ensurePixel", () => {
  it("creates the pixel for a new store, with no Meta pixel", async () => {
    const shop = await makeShop();
    const admin = fakeAdmin(() => ok());
    expect(await ensurePixel(admin, shop)).toBe("synced");

    expect(admin.calls).toHaveLength(1);
    expect(admin.calls[0]?.name).toBe("CreatePixel");
    expect(admin.calls[0]?.settings).toMatchObject({ endpoint: ENDPOINT, metaPixels: "none" });
    const row = await saved(shop.id);
    expect(row.pixelId).toBe(PIXEL);
    expect(row.ingestKey).toBe(admin.calls[0]?.settings.ingestKey);
    expect(row.pixelSettings).toBe(pixelSettingsJson(row.ingestKey ?? "", ENDPOINT, []));
  });

  it("makes no API call when nothing changed", async () => {
    const shop = await makeShop();
    await ensurePixel(
      fakeAdmin(() => ok()),
      shop,
    );
    const admin = fakeAdmin(() => ok());
    expect(await ensurePixel(admin, await saved(shop.id))).toBe("unchanged");
    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("sends the Meta pixel ids once the tool is switched on, and removes them when it is off", async () => {
    const shop = await makeShop();
    await ensurePixel(
      fakeAdmin(() => ok()),
      shop,
    );
    await enablePixels(shop.id, { pixelId1: "11111111", pixelId2: "22222222", pixelId3: "" });

    const admin = fakeAdmin(() => ok());
    expect(await ensurePixel(admin, await saved(shop.id))).toBe("synced");
    expect(admin.calls).toEqual([
      {
        name: "UpdatePixel",
        id: PIXEL,
        settings: expect.objectContaining({ metaPixels: "11111111,22222222" }),
      },
    ]);

    await db.toolSetting.updateMany({ where: { shopId: shop.id }, data: { enabled: false } });
    const off = fakeAdmin(() => ok());
    expect(await ensurePixel(off, await saved(shop.id))).toBe("synced");
    expect(off.calls[0]?.settings.metaPixels).toBe("none");
  });

  it("removes the Meta pixel ids when the plan no longer includes the tool", async () => {
    const shop = await makeShop();
    await enablePixels(shop.id, { pixelId1: "11111111" });
    await ensurePixel(
      fakeAdmin(() => ok()),
      shop,
    );

    await db.shop.update({ where: { id: shop.id }, data: { plan: "starter" } });
    const admin = fakeAdmin(() => ok());
    expect(await ensurePixel(admin, await saved(shop.id))).toBe("synced");
    expect(admin.calls[0]?.settings.metaPixels).toBe("none");
  });

  it("updates the pixel of an older install that never recorded its settings", async () => {
    const shop = await makeShop({ ingestKey: "key-1", pixelId: PIXEL, pixelEndpoint: ENDPOINT });
    const admin = fakeAdmin(() => ok());
    expect(await ensurePixel(admin, shop)).toBe("synced");
    expect(admin.calls).toEqual([
      {
        name: "UpdatePixel",
        id: PIXEL,
        settings: { ingestKey: "key-1", endpoint: ENDPOINT, metaPixels: "none" },
      },
    ]);
  });

  it("finds the existing pixel when Shopify says one is already there", async () => {
    const shop = await makeShop();
    const admin = fakeAdmin((name) => {
      if (name === "CreatePixel") return error("TAKEN");
      if (name === "CurrentPixel") return { webPixel: { id: "gid://shopify/WebPixel/7" } };
      return ok("gid://shopify/WebPixel/7");
    });
    expect(await ensurePixel(admin, shop)).toBe("synced");
    expect(admin.calls.map((c) => c.name)).toEqual(["CreatePixel", "CurrentPixel", "UpdatePixel"]);
    expect((await saved(shop.id)).pixelId).toBe("gid://shopify/WebPixel/7");
  });

  it("creates a new pixel when the remembered one is gone", async () => {
    const shop = await makeShop({ ingestKey: "key-1", pixelId: "gid://shopify/WebPixel/old" });
    const admin = fakeAdmin((name) => (name === "UpdatePixel" ? error("NOT_FOUND") : ok()));
    expect(await ensurePixel(admin, shop)).toBe("synced");
    expect(admin.calls.map((c) => c.name)).toEqual(["UpdatePixel", "CreatePixel"]);
    expect((await saved(shop.id)).pixelId).toBe(PIXEL);
  });

  describe("before the new extension version reached the store", () => {
    it("keeps Analytics working for a new store and reports the Meta ids as pending", async () => {
      const shop = await makeShop();
      await enablePixels(shop.id, { pixelId1: "11111111" });
      const admin = fakeAdmin(oldDefinition);
      expect(await ensurePixel(admin, shop)).toBe("meta-pending");

      expect(admin.calls.map((c) => [c.name, "metaPixels" in c.settings])).toEqual([
        ["CreatePixel", true],
        ["CreatePixel", false],
      ]);
      const row = await saved(shop.id);
      expect(row.pixelId).toBe(PIXEL);
      expect(row.pixelSettings).toBe(pixelSettingsJson(row.ingestKey ?? "", ENDPOINT));
    });

    it("leaves a working pixel alone instead of sending the same settings again", async () => {
      const shop = await makeShop({ ingestKey: "key-1", pixelId: PIXEL, pixelEndpoint: ENDPOINT });
      const admin = fakeAdmin(oldDefinition);
      expect(await ensurePixel(admin, shop)).toBe("synced");
      expect(admin.calls).toHaveLength(1);
      expect((await saved(shop.id)).pixelSettings).toBe(pixelSettingsJson("key-1", ENDPOINT));
    });

    it("waits before trying again on its own, but tries at once after a save", async () => {
      const shop = await makeShop();
      await enablePixels(shop.id, { pixelId1: "11111111" });
      const now = 1_795_000_000_000;
      expect(await ensurePixel(fakeAdmin(oldDefinition), shop, { now })).toBe("meta-pending");

      const soon = fakeAdmin(oldDefinition);
      const current = await saved(shop.id);
      expect(await ensurePixel(soon, current, { now: now + 60_000 })).toBe("skipped");
      expect(soon.graphql).not.toHaveBeenCalled();

      // extension পৌঁছে গেছে, মার্চেন্ট আবার সেভ করলেন
      const forced = fakeAdmin(() => ok());
      expect(await ensurePixel(forced, current, { now: now + 60_000, force: true })).toBe("synced");
      expect(forced.calls[0]?.settings.metaPixels).toBe("11111111");

      // অথবা নিজে থেকে, অপেক্ষার সময় পেরোলে
      resetPixelRetry();
      await ensurePixel(fakeAdmin(oldDefinition), current, { now });
      const later = fakeAdmin(() => ok());
      expect(await ensurePixel(later, current, { now: now + 11 * 60_000 })).toBe("synced");
    });
  });

  it("reports a failure and keeps the ingest key for the next try", async () => {
    const shop = await makeShop();
    const admin = fakeAdmin(() => error("UNEXPECTED_ERROR"));
    expect(await ensurePixel(admin, shop)).toBe("failed");
    const row = await saved(shop.id);
    expect(row.pixelId).toBeNull();
    expect(row.ingestKey).toBeTruthy();
    expect(row.pixelSettings).toBeNull();
  });

  it("does nothing without the app URL", async () => {
    vi.stubEnv("SHOPIFY_APP_URL", "");
    const admin = fakeAdmin(() => ok());
    expect(await ensurePixel(admin, await makeShop())).toBe("skipped");
    expect(admin.graphql).not.toHaveBeenCalled();
  });
});

describe("syncPixel", () => {
  it("reads the store and sends the current settings", async () => {
    const shop = await makeShop();
    await enablePixels(shop.id, { pixelId1: "11111111" });
    const admin = fakeAdmin(() => ok());
    expect(await syncPixel(admin, shop.id)).toBe("synced");
    expect(admin.calls[0]?.settings.metaPixels).toBe("11111111");
  });

  it("skips an uninstalled or unknown store", async () => {
    const shop = await makeShop({ uninstalledAt: new Date() });
    const admin = fakeAdmin(() => ok());
    expect(await syncPixel(admin, shop.id)).toBe("skipped");
    expect(await syncPixel(admin, "missing")).toBe("skipped");
    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("reports a failure instead of throwing when Shopify cannot be reached", async () => {
    const shop = await makeShop();
    const admin = {
      graphql: vi.fn(async () => {
        throw new Error("network");
      }),
    };
    expect(await syncPixel(admin, shop.id)).toBe("failed");
  });
});
