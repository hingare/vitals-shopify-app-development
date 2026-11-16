import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@app/i18n";

vi.mock("../../db.server", async () => ({ default: (await import("../test-db")).fakeDb }));
// স্টোরে লেখার কাজগুলো (Shopify API) নকল: টেস্ট দেখে কখন আর কী দিয়ে ডাকা হলো
vi.mock("../tools.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tools.server")>()),
  saveTool: vi.fn(async () => ({ pixel: null })),
  syncStoreConfig: vi.fn(async () => ({})),
}));
vi.mock("../reviews.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../reviews.server")>()),
  syncProductRating: vi.fn(async () => undefined),
}));
process.env.SHOPIFY_APP_URL = "https://app.example.com";
process.env.SHOPIFY_API_KEY = "test-api-key";
process.env.SHOPIFY_API_SECRET = "test-api-secret";
const { fakeDb: db, resetFakeDb } = await import("../test-db");
const { resetRateLimits } = await import("../rate-limit.server");
const { saveTool, syncStoreConfig } = await import("../tools.server");
const { syncProductRating } = await import("../reviews.server");
const { SUPPORTED_VERSIONS, handleMcpRequest } = await import("./server.server");
const { createAccessKey, disconnect } = await import("./oauth.server");
const { ACTION_STATUSES, decideAction, pendingActions } = await import("./actions.server");

const APP = "https://app.example.com";
const MCP_ID = "storeAddress_0001";
const T0 = new Date("2026-11-14T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const admin = { graphql: vi.fn() };

type Json = Record<string, unknown>;
interface RpcReply {
  id: string | number | null;
  result?: Json;
  error?: { code: number; message: string; data?: Json };
}
interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: Json;
}
interface ListedTool {
  name: string;
  description: string;
  inputSchema: Json & { required?: string[] };
  annotations: Json;
}
interface CallOptions {
  token?: string | null;
  version?: string | null;
  origin?: string;
  method?: string;
  mcpId?: string;
  raw?: string;
  now?: Date;
}

let shop: { id: string; plan: string };
let readKey: string;
let writeKey: string;

async function newKey(name: string, write: boolean) {
  const created = await createAccessKey(shop.id, { name, write });
  if (!created.ok) throw new Error("could not create a key");
  return created.key;
}

async function post(body: unknown, options: CallOptions = {}) {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  const token = options.token === undefined ? writeKey : options.token;
  if (token) headers.set("authorization", `Bearer ${token}`);
  const version = options.version === undefined ? "2025-11-25" : options.version;
  if (version) headers.set("mcp-protocol-version", version);
  if (options.origin) headers.set("origin", options.origin);
  const method = options.method ?? "POST";
  const mcpId = options.mcpId ?? MCP_ID;
  const request = new Request(`${APP}/mcp/${mcpId}`, {
    method,
    headers,
    body: method === "POST" ? (options.raw ?? JSON.stringify(body)) : undefined,
  });
  const response = await handleMcpRequest(request, mcpId, options.now ?? T0);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: (text ? JSON.parse(text) : null) as unknown,
  };
}

const rpc = (method: string, params?: unknown, id: string | number = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

const resultOf = (body: unknown) => (body as RpcReply).result as Json;

async function callTool(name: string, args: unknown = {}, options: CallOptions = {}) {
  const reply = await post(rpc("tools/call", { name, arguments: args }), options);
  expect(reply.status).toBe(200);
  const result = resultOf(reply.body) as unknown as ToolResult;
  const text = result.content[0]?.text ?? "";
  return { ...result, text, data: (result.isError ? null : JSON.parse(text)) as Json | null };
}

async function listTools(token: string) {
  const reply = await post(rpc("tools/list"), { token });
  return resultOf(reply.body).tools as ListedTool[];
}

const requestIdOf = (data: Json | null) => String(data?.requestId);

beforeEach(async () => {
  resetFakeDb();
  resetRateLimits();
  vi.clearAllMocks();
  const row = db.shop.seed({ domain: "a.myshopify.com", plan: "professional", mcpId: MCP_ID });
  shop = { id: row.id as string, plan: "professional" };
  readKey = await newKey("Reader", false);
  writeKey = await newKey("Claude", true);
});

describe("MCP endpoint", () => {
  it("asks for a token and says where to get one", async () => {
    const reply = await post(rpc("tools/list"), { token: null });
    expect(reply.status).toBe(401);
    const challenge = reply.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(
      `resource_metadata="${APP}/.well-known/oauth-protected-resource/mcp/${MCP_ID}"`,
    );
    expect(challenge).toContain('scope="read write"');
    expect(challenge).not.toContain("error=");
    expect(reply.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");

    const bad = await post(rpc("tools/list"), { token: "mcp_at_wrong" });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("only takes POST, and answers the browser's preflight", async () => {
    const get = await post(null, { method: "GET" });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST, OPTIONS");
    expect((await post(null, { method: "DELETE" })).status).toBe(405);
    const preflight = await post(null, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("MCP-Protocol-Version");
  });

  it("refuses web pages from other sites, but not https or local clients", async () => {
    expect((await post(rpc("ping"), { origin: "http://evil.example" })).status).toBe(403);
    expect((await post(rpc("ping"), { origin: "null" })).status).toBe(403);
    expect((await post(rpc("ping"), { origin: "https://chatgpt.com" })).status).toBe(200);
    expect((await post(rpc("ping"), { origin: "http://localhost:6274" })).status).toBe(200);
  });

  it("keeps each token to its own store's address", async () => {
    expect((await post(rpc("ping"), { mcpId: "bad id" })).status).toBe(404);
    db.shop.seed({ domain: "b.myshopify.com", mcpId: "otherStoreAddr001" });
    expect((await post(rpc("ping"), { mcpId: "otherStoreAddr001" })).status).toBe(401);
  });

  it("agrees on a protocol version", async () => {
    const init = (version: string) =>
      rpc("initialize", {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      });
    expect((await post(init("2025-06-18"), { version: null })).body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "allinone-shopify", title: "AllInOne for Shopify" },
      },
    });
    expect((await post(init("2024-01-01"), { version: null })).body).toMatchObject({
      result: { protocolVersion: SUPPORTED_VERSIONS[0] },
    });

    // নতুন সংস্করণের ক্লায়েন্ট সমর্থিত তালিকা পেয়ে initialize-এর পথে আসে
    const newer = await post(rpc("tools/list", undefined, 7), { version: "2026-07-28" });
    expect(newer.status).toBe(400);
    expect(newer.body).toMatchObject({
      id: 7,
      error: {
        code: -32022,
        data: { supported: [...SUPPORTED_VERSIONS], requested: "2026-07-28" },
      },
    });
    expect((await post(init("2026-07-28"), { version: "2026-07-28" })).status).toBe(200);
  });

  it("tells the assistant whether it can ask for changes", async () => {
    const init = rpc("initialize", { protocolVersion: "2025-11-25" });
    const write = resultOf((await post(init)).body);
    expect(write.instructions).toContain("store owner approves");
    const read = resultOf((await post(init, { token: readKey })).body);
    expect(read.instructions).toContain("can only read");
  });

  it("answers notifications with nothing and batches with a list", async () => {
    const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
    expect(note.body).toBeNull();
    const batch = await post([
      { jsonrpc: "2.0", method: "notifications/initialized" },
      rpc("ping", undefined, "a"),
    ]);
    expect(batch.body).toEqual([{ jsonrpc: "2.0", id: "a", result: {} }]);
  });

  it("reports broken requests", async () => {
    expect((await post(rpc("resources/list"))).body).toMatchObject({ error: { code: -32601 } });
    const parse = await post(null, { raw: "{not json" });
    expect(parse.status).toBe(400);
    expect(parse.body).toMatchObject({ error: { code: -32700 } });
    expect((await post({ id: 1, method: "ping" })).body).toMatchObject({
      id: null,
      error: { code: -32600 },
    });
    expect((await post({ jsonrpc: "2.0", id: { bad: true }, method: "ping" })).body).toMatchObject({
      id: null,
      error: { code: -32600 },
    });
    expect((await post([])).status).toBe(400);
    const tooMany = Array.from({ length: 21 }, (_, i) => rpc("ping", undefined, i));
    expect((await post(tooMany)).status).toBe(400);
    const huge = JSON.stringify({ ...rpc("ping"), pad: "x".repeat(300_000) });
    expect((await post(null, { raw: huge })).status).toBe(413);
  });

  it("limits each connection to 120 calls a minute", async () => {
    for (let i = 0; i < 120; i++) await post(rpc("ping"));
    const limited = await post(rpc("ping"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect((await post(rpc("ping"), { token: readKey })).status).toBe(200);
  });
});

describe("tools", () => {
  it("lists tools by permission, each with a strict input schema", async () => {
    const readTools = (await listTools(readKey)).map((item) => item.name);
    expect(readTools).toHaveLength(9);
    expect(readTools.filter((name) => name.startsWith("request_"))).toEqual([]);

    const all = await listTools(writeKey);
    expect(all).toHaveLength(12);
    for (const item of all) {
      expect(item.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(item.inputSchema).not.toHaveProperty("$schema");
      expect(item.annotations).toMatchObject({
        readOnlyHint: !item.name.startsWith("request_"),
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(item.description.length).toBeGreaterThan(40);
    }
    const reviews = all.find((item) => item.name === "list_reviews")!;
    expect(reviews.inputSchema).toMatchObject({
      properties: {
        status: { enum: ["pending", "published", "rejected"], default: "pending" },
        limit: { maximum: 50 },
      },
    });
    expect(reviews.inputSchema.required ?? []).toEqual([]);
    const reviewChange = all.find((item) => item.name === "request_review_change")!;
    expect(reviewChange.inputSchema.required).toEqual(["reviewId", "action"]);
  });

  it("keeps change requests away from read-only connections", async () => {
    const result = await callTool(
      "request_feature_change",
      { featureId: "sticky-atc", enabled: true },
      { token: readKey },
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("can only read");
    expect(db.mcpAction.rows).toHaveLength(0);
  });

  it("refuses unknown tools, bad arguments and stores without Professional", async () => {
    const unknown = await post(rpc("tools/call", { name: "delete_store", arguments: {} }));
    expect(unknown.body).toMatchObject({ error: { code: -32602 } });
    const bad = await callTool("list_reviews", { limit: 500 });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("Invalid arguments");
    db.shop.rows[0]!.plan = "starter";
    const starter = await callTool("get_review_stats");
    expect(starter.isError).toBe(true);
    expect(starter.text).toContain("Professional plan");
  });

  it("sends structured results only to clients that know them", async () => {
    const newer = await callTool("get_review_stats");
    expect(newer.structuredContent).toEqual(newer.data);
    const older = await callTool("get_review_stats", {}, { version: null });
    expect(older.structuredContent).toBeUndefined();
    expect(older.data).toMatchObject({ publishedAverage: null });
  });

  it("never shares shoppers' emails or full names", async () => {
    const review = { shopId: shop.id, productId: "111", title: "Nice", verified: true };
    db.review.seed({
      ...review,
      rating: 5,
      body: "Great",
      authorName: "Rahim Karim",
      authorEmail: "rahim@example.com",
    });
    db.review.seed({
      ...review,
      rating: 2,
      body: "Meh",
      authorName: "Sara",
      authorEmail: "sara@example.com",
      status: "published",
    });
    const pending = await callTool("list_reviews");
    expect(pending.text).not.toContain("@example.com");
    expect(pending.text).not.toContain("Karim");
    expect(pending.data).toMatchObject({
      status: "pending",
      counts: { pending: 1, published: 1, rejected: 0 },
      reviews: [
        { author: "Rahim K.", rating: 5, text: "Great", productId: "111", verifiedBuyer: true },
      ],
    });
    const published = await callTool("list_reviews", { status: "published" });
    expect(published.data).toMatchObject({ reviews: [{ author: "Sara", rating: 2 }] });
  });

  it("sums up reviews by stars", async () => {
    const review = { shopId: shop.id, body: "x", authorName: "A" };
    for (const rating of [5, 5, 4]) db.review.seed({ ...review, rating, status: "published" });
    db.review.seed({ ...review, rating: 1 });
    expect((await callTool("get_review_stats")).data).toEqual({
      counts: { pending: 1, published: 3, rejected: 0 },
      publishedAverage: 4.67,
      publishedByStars: { "1": 0, "2": 0, "3": 0, "4": 1, "5": 2 },
    });
  });

  it("gives a store overview and the feature list", async () => {
    db.toolSetting.seed({ shopId: shop.id, toolId: "sticky-atc", enabled: true });
    db.offer.seed({ shopId: shop.id, type: "volume", name: "Buy 2", active: true });
    db.offer.seed({ shopId: shop.id, type: "bundle", name: "Kit", active: false });
    expect((await callTool("get_store_overview")).data).toMatchObject({
      store: "a.myshopify.com",
      plan: "professional",
      featuresOn: [{ id: "sticky-atc", name: "Sticky Add to Cart" }],
      activeOffers: 1,
      changeRequestsWaiting: 0,
      appAdmin: "https://a.myshopify.com/admin/apps/test-api-key/app",
    });

    const features = (await callTool("list_features")).data?.features as Json[];
    expect(features.find((item) => item.id === "sticky-atc")).toMatchObject({
      name: "Sticky Add to Cart",
      on: true,
      canTurnOff: true,
      includedInPlan: true,
    });
    expect(features.find((item) => item.id === "ai-descriptions")).toMatchObject({
      on: true,
      canTurnOff: false,
    });
    expect(features.filter((item) => String(item.name).startsWith("tool."))).toEqual([]);
    const onlyOn = (await callTool("list_features", { onlyOn: true })).data?.features as Json[];
    expect(onlyOn.every((item) => item.on)).toBe(true);
    expect(onlyOn.length).toBeLessThan(features.length);
  });
});

describe("change requests", () => {
  it("turns a feature on only after the owner approves", async () => {
    const asked = await callTool("request_feature_change", {
      featureId: "sticky-atc",
      enabled: true,
    });
    expect(asked.data).toMatchObject({
      status: "waiting_for_approval",
      summary: "Turn on Sticky Add to Cart",
    });
    const id = requestIdOf(asked.data);
    expect(asked.data?.approveUrl).toBe(
      `https://a.myshopify.com/admin/apps/test-api-key/app/assistants?action=${id}`,
    );
    expect(saveTool).not.toHaveBeenCalled();
    expect(db.toolSetting.rows).toHaveLength(0);
    expect(await pendingActions(shop.id, T0)).toMatchObject([
      {
        id,
        assistant: "Claude",
        status: "pending",
        input: { featureId: "sticky-atc", enabled: true },
      },
    ]);
    expect((await callTool("get_store_overview")).data).toMatchObject({ changeRequestsWaiting: 1 });

    expect(await decideAction(admin, shop, id, true, T0)).toEqual({ ok: true, status: "done" });
    expect(saveTool).toHaveBeenCalledWith(
      admin,
      { id: shop.id, plan: "professional" },
      "sticky-atc",
      {
        enabled: true,
      },
    );
    // দুবার চাপলেও কাজ একবার
    expect(await decideAction(admin, shop, id, true, T0)).toEqual({ ok: false, error: "decided" });
    expect(saveTool).toHaveBeenCalledTimes(1);

    expect((await callTool("list_change_requests")).data).toMatchObject({
      requests: [
        { requestId: id, status: "done", askedBy: "Claude", summary: "Turn on Sticky Add to Cart" },
      ],
    });
  });

  it("says when nothing would change or the feature does not exist", async () => {
    db.toolSetting.seed({ shopId: shop.id, toolId: "sticky-atc", enabled: true });
    const same = await callTool("request_feature_change", {
      featureId: "sticky-atc",
      enabled: true,
    });
    expect(same.data).toMatchObject({ status: "unchanged" });
    const unknown = await callTool("request_feature_change", {
      featureId: "teleport",
      enabled: true,
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("list_features");
    const always = await callTool("request_feature_change", {
      featureId: "ai-descriptions",
      enabled: false,
    });
    expect(always.text).toContain("always on");
    expect(db.mcpAction.rows).toHaveLength(0);
  });

  it("lets the owner say no, and only the owner's store decide", async () => {
    const asked = await callTool("request_feature_change", {
      featureId: "sticky-atc",
      enabled: true,
    });
    const id = requestIdOf(asked.data);
    const otherStore = { id: "someone-else", plan: "professional" };
    expect(await decideAction(admin, otherStore, id, true, T0)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await decideAction(admin, shop, id, false, T0)).toEqual({
      ok: true,
      status: "rejected",
    });
    expect(saveTool).not.toHaveBeenCalled();
    expect(db.mcpAction.rows[0]).toMatchObject({ status: "rejected", decidedAt: T0 });
  });

  it("lets a request expire after a week", async () => {
    const asked = await callTool("request_feature_change", {
      featureId: "sticky-atc",
      enabled: true,
    });
    const id = requestIdOf(asked.data);
    expect(await decideAction(admin, shop, id, true, at(7 * 86_400))).toEqual({
      ok: false,
      error: "expired",
    });
    expect(db.mcpAction.rows[0]!.status).toBe("expired");
    expect(saveTool).not.toHaveBeenCalled();
  });

  it("cancels the waiting requests of a disconnected assistant", async () => {
    const asked = await callTool("request_feature_change", {
      featureId: "sticky-atc",
      enabled: true,
    });
    const grant = db.mcpGrant.rows.find((row) => row.name === "Claude")!;
    await disconnect(shop.id, grant.id as string, T0);
    expect(await decideAction(admin, shop, requestIdOf(asked.data), true, T0)).toEqual({
      ok: false,
      error: "decided",
    });
    expect(saveTool).not.toHaveBeenCalled();
  });

  it("turns an offer on after approval, and reports an offer deleted meanwhile", async () => {
    const offer = db.offer.seed({
      shopId: shop.id,
      type: "volume",
      name: "Buy 2 save 10%",
      active: false,
    });
    const on = await callTool("request_offer_change", { offerId: offer.id, active: true });
    expect(on.data).toMatchObject({
      status: "waiting_for_approval",
      summary: "Turn on the offer “Buy 2 save 10%”",
    });
    expect(db.offer.rows[0]!.active).toBe(false);
    expect(await decideAction(admin, shop, requestIdOf(on.data), true, T0)).toEqual({
      ok: true,
      status: "done",
    });
    expect(db.offer.rows[0]!.active).toBe(true);
    expect(syncStoreConfig).toHaveBeenCalledWith(admin, { id: shop.id, plan: "professional" });

    const off = await callTool("request_offer_change", { offerId: offer.id, active: false });
    await db.offer.deleteMany({});
    expect(await decideAction(admin, shop, requestIdOf(off.data), true, T0)).toEqual({
      ok: false,
      error: "failed",
      message: "This offer no longer exists.",
    });
    expect(db.mcpAction.rows[1]).toMatchObject({
      status: "failed",
      error: "This offer no longer exists.",
    });

    const missing = await callTool("request_offer_change", { offerId: "nope", active: true });
    expect(missing.text).toContain("list_offers");
  });

  it("publishes and answers reviews after approval without storing the shopper's name", async () => {
    const review = db.review.seed({
      shopId: shop.id,
      productId: "111",
      rating: 5,
      body: "Great",
      authorName: "Rahim Karim",
    });
    const noReply = await callTool("request_review_change", {
      reviewId: review.id,
      action: "reply",
    });
    expect(noReply.isError).toBe(true);
    expect(noReply.text).toContain("reply is required");

    const publish = await callTool("request_review_change", {
      reviewId: review.id,
      action: "publish",
    });
    expect(publish.data).toMatchObject({ summary: "Publish the 5-star review by Rahim K." });
    expect(db.mcpAction.rows[0]!.details).toEqual({ rating: 5 });
    expect(JSON.stringify(db.mcpAction.rows)).not.toContain("Rahim");
    expect(db.review.rows[0]!.status).toBe("pending");
    // অ্যাপের তালিকায় নামটা রিভিউ থেকেই পড়ে দেখায়
    expect(await pendingActions(shop.id, T0)).toMatchObject([
      { details: { rating: 5, author: "Rahim K." } },
    ]);

    expect(await decideAction(admin, shop, requestIdOf(publish.data), true, T0)).toEqual({
      ok: true,
      status: "done",
    });
    expect(db.review.rows[0]!.status).toBe("published");
    expect(syncProductRating).toHaveBeenCalledWith(admin, shop.id, "111");

    const reply = await callTool("request_review_change", {
      reviewId: review.id,
      action: "reply",
      reply: "Thank you!",
    });
    expect(reply.data).toMatchObject({
      summary: "Reply to the 5-star review by Rahim K.: “Thank you!”",
    });
    await decideAction(admin, shop, requestIdOf(reply.data), true, T0);
    expect(db.review.rows[0]!.reply).toBe("Thank you!");

    const again = await callTool("request_review_change", {
      reviewId: review.id,
      action: "publish",
    });
    expect(again.data).toMatchObject({ status: "unchanged" });
  });

  it("keeps the waiting list and the daily number of requests limited", async () => {
    const action = { shopId: shop.id, assistant: "x", tool: "request_feature_change", input: {} };
    for (let i = 0; i < 25; i++) db.mcpAction.seed({ ...action, expiresAt: at(86_400) });
    const full = await callTool("request_feature_change", {
      featureId: "sticky-atc",
      enabled: true,
    });
    expect(full.isError).toBe(true);
    expect(full.text).toContain("waiting for the store owner");

    resetFakeDb();
    db.shop.seed({ id: shop.id, domain: "a.myshopify.com", plan: "professional", mcpId: MCP_ID });
    writeKey = await newKey("Claude", true);
    for (let i = 0; i < 100; i++) {
      db.mcpAction.seed({ ...action, status: "rejected", expiresAt: T0, createdAt: at(-3_600) });
    }
    const busy = await callTool("request_feature_change", {
      featureId: "sticky-atc",
      enabled: true,
    });
    expect(busy.text).toContain("Too many requests today");
  });
});

describe("assistant page texts", () => {
  const missing = (keys: string[]) => keys.filter((key) => translate("en", key) === key);

  it("has English text for every fixed and generated key", () => {
    const files = [
      "../../routes/app.assistants._index.tsx",
      "../../routes/app.assistants.connect.tsx",
      "../../routes/oauth.authorize.tsx",
      "../../routes/oauth.store.tsx",
      "../../routes/oauth.complete.tsx",
      "../../routes/app.integrations.tsx",
      "../../routes/app.tsx",
    ];
    const keys = new Set<string>();
    for (const file of files) {
      const source = readFileSync(join(__dirname, file), "utf8");
      for (const match of source.matchAll(
        /["'`]((?:assistants|oauth|nav|integrations)\.[\w.:-]+)["'`]/g,
      )) {
        keys.add(match[1]!);
      }
    }
    expect(keys.size).toBeGreaterThan(40);
    const guides = ["chatgpt", "claude", "gemini", "grok", "other"];
    const generated = [
      ...ACTION_STATUSES.map((status) => `assistants.status.${status}`),
      ...["not_found", "decided", "expired", "failed", "unknown"].map(
        (e) => `assistants.error.${e}`,
      ),
      ...["not_found", "expired", "used", "other_store"].map(
        (p) => `assistants.connect.problem.${p}`,
      ),
      ...guides.flatMap((id) => [1, 2, 3].map((step) => `assistants.guide.${id}.${step}`)),
      ...guides.map((id) => `assistants.guide.${id}`),
      "assistants.kind.oauth",
      "assistants.kind.key",
      "assistants.access.read",
      "assistants.access.write",
    ];
    expect(missing([...keys, ...generated])).toEqual([]);
  });

  it("fills every placeholder of the setup steps", () => {
    for (const id of ["chatgpt", "claude", "gemini", "grok", "other"]) {
      for (const step of [1, 2, 3]) {
        const text = translate("en", `assistants.guide.${id}.${step}`, {
          url: `${APP}/mcp/${MCP_ID}`,
          name: "allinone",
        });
        expect(text).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
