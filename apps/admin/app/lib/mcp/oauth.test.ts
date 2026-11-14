import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthReply } from "./oauth.server";

vi.mock("../../db.server", async () => ({ default: (await import("../test-db")).fakeDb }));
process.env.SHOPIFY_APP_URL = "https://app.example.com";
process.env.SHOPIFY_API_KEY = "test-api-key";
process.env.SHOPIFY_API_SECRET = "test-api-secret";
const { fakeDb: db, resetFakeDb } = await import("../test-db");
const { resetRateLimits } = await import("../rate-limit.server");
const oauth = await import("./oauth.server");

const APP = "https://app.example.com";
const MCP_ID = "storeAddress_0001";
const RESOURCE = `${APP}/mcp/${MCP_ID}`;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const IP = "203.0.113.5";
const T0 = new Date("2026-11-14T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const VERIFIER = "a-very-long-code-verifier-that-is-random-enough-1234567890";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

type Json = Record<string, unknown>;
type Tokens = { access_token: string; refresh_token: string; scope: string };
type Store = { id: string; mcpId: string | null };
let shop: Store;

const form = (fields: Record<string, string>) => new URLSearchParams(fields);

async function register(meta: Json = {}) {
  const reply = await oauth.registerClient(
    {
      client_name: "Claude",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      ...meta,
    },
    IP,
    T0,
  );
  expect(reply.status).toBe(201);
  return reply.body as { client_id: string; client_secret?: string; client_name: string };
}

const authorizeParams = (clientId: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "state-123",
    scope: "read write",
    resource: RESOURCE,
    ...extra,
  });

const authorize = (clientId: string, extra: Record<string, string> = {}) =>
  oauth.startAuthorization(authorizeParams(clientId, extra), IP, T0);

/** অনুমতির শুরু থেকে স্টোরের অ্যাডমিনে সম্মতির পাতার অনুরোধ id */
async function consentRequest(clientId: string, extra: Record<string, string> = {}) {
  const start = await authorize(clientId, extra);
  if (start.kind !== "redirect") throw new Error(`expected a redirect, got ${start.kind}`);
  return new URL(start.url).searchParams.get("request")!;
}

/** সম্মতির পাতা → /oauth/complete → সহকারীর ঠিকানা */
async function consent(
  requestId: string,
  decision = { allow: true, write: true },
  store: Store = shop,
): Promise<URL> {
  const decided = await oauth.decideConsent(requestId, store, decision, T0);
  if (!("next" in decided)) throw new Error(`consent failed: ${decided.problem}`);
  const next = new URL(decided.next);
  expect(`${next.origin}${next.pathname}`).toBe(`${APP}/oauth/complete`);
  const back = await oauth.completeAuthorization(
    next.searchParams.get("request")!,
    next.searchParams.get("sig")!,
    T0,
  );
  return new URL(back!);
}

const exchange = (clientId: string, code: string, extra: Record<string, string> = {}, now = T0) =>
  oauth.tokenRequest(
    form({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      client_id: clientId,
      ...extra,
    }),
    null,
    now,
  );

const refresh = (clientId: string, token: string, now = T0, extra: Record<string, string> = {}) =>
  oauth.tokenRequest(
    form({ grant_type: "refresh_token", refresh_token: token, client_id: clientId, ...extra }),
    null,
    now,
  );

const bearer = (token: string, now = T0, mcpId = MCP_ID) =>
  oauth.authenticateBearer(`Bearer ${token}`, mcpId, now);

/** পুরো সংযোগ: নথিভুক্তি, সম্মতি, টোকেন */
async function connect(options: { write?: boolean } = {}) {
  const client = await register();
  const back = await consent(await consentRequest(client.client_id), {
    allow: true,
    write: options.write ?? true,
  });
  const code = back.searchParams.get("code")!;
  const reply = await exchange(client.client_id, code, {
    redirect_uri: REDIRECT,
    resource: RESOURCE,
  });
  expect(reply.status).toBe(200);
  return { client, code, ...(reply.body as Tokens) };
}

const errorOf = async (reply: Promise<OAuthReply>) => {
  const { status, body } = await reply;
  return [status, body.error];
};

beforeEach(() => {
  resetFakeDb();
  resetRateLimits();
  oauth.setClientFetchForTests(null);
  const row = db.shop.seed({ domain: "a.myshopify.com", plan: "professional", mcpId: MCP_ID });
  shop = { id: row.id as string, mcpId: MCP_ID };
});

describe("discovery", () => {
  it("describes the authorization server and the store's MCP address", () => {
    expect(oauth.authorizationServerMetadata()).toMatchObject({
      issuer: APP,
      authorization_endpoint: `${APP}/oauth/authorize`,
      token_endpoint: `${APP}/oauth/token`,
      registration_endpoint: `${APP}/oauth/register`,
      revocation_endpoint: `${APP}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(oauth.protectedResourceMetadata(RESOURCE)).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [APP],
      scopes_supported: ["read", "write"],
      bearer_methods_supported: ["header"],
    });
    expect(oauth.resourceMetadataUrl(MCP_ID)).toBe(
      `${APP}/.well-known/oauth-protected-resource/mcp/${MCP_ID}`,
    );
  });

  it("always includes read in the asked permissions", () => {
    expect(oauth.parseScopes(null)).toEqual(["read", "write"]);
    expect(oauth.parseScopes("write")).toEqual(["read", "write"]);
    expect(oauth.parseScopes("read")).toEqual(["read"]);
    expect(oauth.parseScopes("openid read")).toEqual(["read"]);
  });
});

describe("connecting an assistant", () => {
  it("goes from registration to a token that works only on this store's address", async () => {
    const client = await register();
    expect(client.client_id).toMatch(/^mcp_client_/);
    expect(client.client_secret).toBeUndefined();

    const start = await authorize(client.client_id);
    if (start.kind !== "redirect") throw new Error("expected a redirect");
    const page = new URL(start.url);
    expect(`${page.origin}${page.pathname}`).toBe(
      "https://a.myshopify.com/admin/apps/test-api-key/app/assistants/connect",
    );
    const requestId = page.searchParams.get("request")!;
    expect(await oauth.consentView(requestId, shop.id, T0)).toMatchObject({
      problem: null,
      clientName: "Claude",
      verifiedHost: null,
      returnTo: "claude.ai",
      write: true,
    });

    const back = await consent(requestId);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("state-123");
    expect(back.searchParams.get("iss")).toBe(APP);
    const code = back.searchParams.get("code")!;
    expect(code).toMatch(/^mcp_code_/);

    const reply = await exchange(client.client_id, code, {
      redirect_uri: REDIRECT,
      resource: RESOURCE,
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "read write",
    });
    const { access_token: access, refresh_token: refreshToken } = reply.body as Tokens;
    expect(access).toMatch(/^mcp_at_/);
    expect(refreshToken).toMatch(/^mcp_rt_/);

    // ডাটাবেসে শুধু hash থাকে
    const stored = JSON.stringify([db.mcpGrant.rows, db.mcpAuthRequest.rows]);
    for (const secret of [access, refreshToken, code]) expect(stored).not.toContain(secret);

    const ok = await bearer(access);
    if (!ok.ok) throw new Error("token was refused");
    expect(ok.shop.id).toBe(shop.id);
    expect(ok.grant).toMatchObject({
      kind: "oauth",
      name: "Claude",
      scopes: ["read", "write"],
      resource: RESOURCE,
    });
    expect(await bearer(access, T0, "otherStoreAddr001")).toEqual({ ok: false, error: "invalid" });
    expect(await bearer(access, at(3600))).toEqual({ ok: false, error: "invalid" });
    expect(await oauth.authenticateBearer(null, MCP_ID, T0)).toEqual({
      ok: false,
      error: "missing",
    });
    expect(await oauth.authenticateBearer("Basic abc", MCP_ID, T0)).toEqual({
      ok: false,
      error: "missing",
    });
  });

  it("lets the store owner leave out change requests", async () => {
    const { access_token, scope } = await connect({ write: false });
    expect(scope).toBe("read");
    const result = await bearer(access_token);
    expect(result.ok && result.grant.scopes).toEqual(["read"]);
  });

  it("uses the only registered return address when the assistant leaves it out", async () => {
    const client = await register();
    const params = authorizeParams(client.client_id);
    params.delete("redirect_uri");
    expect(await oauth.startAuthorization(params, IP, T0)).toMatchObject({ kind: "redirect" });
  });

  it("never sends anything to a return address the assistant did not register", async () => {
    const client = await register();
    expect(await authorize("mcp_client_unknown")).toMatchObject({ kind: "error" });
    expect(
      await authorize(client.client_id, { redirect_uri: "https://evil.example/cb" }),
    ).toMatchObject({ kind: "error" });
  });

  it("sends other mistakes back to the assistant with its state", async () => {
    const client = await register();
    const problem = async (params: URLSearchParams) => {
      const result = await oauth.startAuthorization(params, IP, T0);
      if (result.kind !== "redirect") throw new Error(result.kind);
      const url = new URL(result.url);
      expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
      expect(url.searchParams.get("state")).toBe("state-123");
      expect(url.searchParams.get("iss")).toBe(APP);
      return url.searchParams.get("error");
    };
    const params = (extra: Record<string, string>) => authorizeParams(client.client_id, extra);
    expect(await problem(params({ response_type: "token" }))).toBe("unsupported_response_type");
    expect(await problem(params({ code_challenge_method: "plain" }))).toBe("invalid_request");
    expect(await problem(params({ code_challenge: "too-short" }))).toBe("invalid_request");
    expect(await problem(params({ resource: "https://evil.example/mcp" }))).toBe("invalid_target");
    expect(await problem(params({ resource: `${APP}/mcp/unknownStore00001` }))).toBe(
      "invalid_target",
    );
    const two = params({});
    two.append("resource", RESOURCE);
    expect(await problem(two)).toBe("invalid_target");
    db.shop.rows[0]!.uninstalledAt = T0;
    expect(await problem(params({}))).toBe("invalid_target");
    expect(db.mcpAuthRequest.rows).toHaveLength(0);
  });

  it("asks for the store when the assistant starts from the general address", async () => {
    const second = db.shop.seed({ domain: "b.myshopify.com", plan: "professional" });
    const loopback = "http://localhost:7777/oauth/callback";
    const client = await register({ client_name: "Gemini CLI", redirect_uris: [loopback] });
    const start = await authorize(client.client_id, {
      redirect_uri: loopback,
      resource: `${APP}/mcp`,
    });
    expect(start).toMatchObject({ kind: "choose_store", clientName: "Gemini CLI" });
    const requestId = (start as { requestId: string }).requestId;
    expect(await oauth.pendingStoreRequest(requestId, T0)).toEqual({ clientName: "Gemini CLI" });
    expect(await oauth.storeConsentUrl(requestId, "not a store!", T0)).toBeNull();
    expect(await oauth.storeConsentUrl(requestId, " B ", T0)).toBe(
      `https://b.myshopify.com/admin/apps/test-api-key/app/assistants/connect?request=${requestId}`,
    );

    // সম্মতির সময় স্টোর ঠিক হয়, আর তখনই স্টোরের MCP ঠিকানা তৈরি হয়
    const back = await consent(
      requestId,
      { allow: true, write: true },
      {
        id: second.id as string,
        mcpId: null,
      },
    );
    const mcpId = db.shop.rows.find((row) => row.id === second.id)!.mcpId as string;
    expect(oauth.isMcpId(mcpId)).toBe(true);
    expect(await oauth.pendingStoreRequest(requestId, T0)).toBeNull();

    const reply = await exchange(client.client_id, back.searchParams.get("code")!, {
      resource: `${APP}/mcp`,
    });
    expect(reply.status).toBe(200);
    const token = (reply.body as Tokens).access_token;
    expect((await bearer(token, T0, mcpId)).ok).toBe(true);
    expect((await bearer(token, T0, MCP_ID)).ok).toBe(false);
  });

  it("reads what the owner typed as their store", () => {
    expect(oauth.normalizeShopDomain("MyStore")).toBe("mystore.myshopify.com");
    expect(oauth.normalizeShopDomain(" https://my-store.myshopify.com/admin ")).toBe(
      "my-store.myshopify.com",
    );
    expect(oauth.normalizeShopDomain("https://admin.shopify.com/store/my-store/products")).toBe(
      "my-store.myshopify.com",
    );
    expect(oauth.normalizeShopDomain("evil.com")).toBeNull();
    expect(oauth.normalizeShopDomain("my store")).toBeNull();
    expect(oauth.normalizeShopDomain("")).toBeNull();
  });

  it("explains why a consent page can't be used", async () => {
    const client = await register();
    const requestId = await consentRequest(client.client_id);
    const other = { id: db.shop.seed({ domain: "b.myshopify.com" }).id as string, mcpId: null };
    const allow = { allow: true, write: true };
    expect(await oauth.consentView("missing", shop.id, T0)).toEqual({ problem: "not_found" });
    expect(await oauth.consentView(requestId, other.id, T0)).toEqual({ problem: "other_store" });
    expect(await oauth.consentView(requestId, shop.id, at(15 * 60))).toEqual({
      problem: "expired",
    });
    expect(await oauth.decideConsent(requestId, other, allow, T0)).toEqual({
      problem: "other_store",
    });
    await consent(requestId);
    expect(await oauth.consentView(requestId, shop.id, T0)).toEqual({ problem: "used" });
    expect(await oauth.decideConsent(requestId, shop, allow, T0)).toEqual({ problem: "used" });
  });

  it("tells the assistant once when the owner says no", async () => {
    const client = await register();
    const requestId = await consentRequest(client.client_id);
    const decided = await oauth.decideConsent(requestId, shop, { allow: false, write: false }, T0);
    const sig = new URL((decided as { next: string }).next).searchParams.get("sig")!;
    const back = new URL((await oauth.completeAuthorization(requestId, sig, T0))!);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("state-123");
    expect(back.searchParams.get("code")).toBeNull();
    expect(await oauth.completeAuthorization(requestId, sig, T0)).toBeNull();
    expect(db.mcpGrant.rows).toHaveLength(0);
  });

  it("gives the code only through the signed link, once and in time", async () => {
    const client = await register();
    const requestId = await consentRequest(client.client_id);
    const decided = await oauth.decideConsent(requestId, shop, { allow: true, write: true }, T0);
    const sig = new URL((decided as { next: string }).next).searchParams.get("sig")!;
    expect(await oauth.completeAuthorization(requestId, "forged", T0)).toBeNull();
    expect(await oauth.completeAuthorization(requestId, sig, at(301))).toBeNull();
    expect(await oauth.completeAuthorization(requestId, sig, T0)).toContain("code=mcp_code_");
    expect(await oauth.completeAuthorization(requestId, sig, T0)).toBeNull();
  });
});

describe("codes and tokens", () => {
  it("accepts a code once, and closes the connection if it comes again", async () => {
    const { client, code, access_token } = await connect();
    expect(await errorOf(exchange(client.client_id, code))).toEqual([400, "invalid_grant"]);
    expect(await bearer(access_token)).toEqual({ ok: false, error: "invalid" });
  });

  it("binds a code to its assistant, return address, verifier, store and time", async () => {
    const client = await register();
    const other = await register({ client_name: "Other" });
    const back = await consent(await consentRequest(client.client_id));
    const code = back.searchParams.get("code")!;
    const id = client.client_id;
    expect(await errorOf(exchange(other.client_id, code))).toEqual([400, "invalid_grant"]);
    expect(await errorOf(exchange(id, code, { redirect_uri: "https://claude.ai/other" }))).toEqual([
      400,
      "invalid_grant",
    ]);
    expect(await errorOf(exchange(id, code, { code_verifier: "x".repeat(43) }))).toEqual([
      400,
      "invalid_grant",
    ]);
    expect(await errorOf(exchange(id, code, { resource: `${APP}/mcp/someoneElse000001` }))).toEqual(
      [400, "invalid_target"],
    );
    expect(await errorOf(exchange(id, code, {}, at(301)))).toEqual([400, "invalid_grant"]);
    expect(await errorOf(exchange(id, ""))).toEqual([400, "invalid_request"]);
    // ভুল চেষ্টায় code নষ্ট হয় না
    expect((await exchange(id, code)).status).toBe(200);
  });

  it("refuses a code after the app was uninstalled", async () => {
    const client = await register();
    const back = await consent(await consentRequest(client.client_id));
    db.shop.rows[0]!.uninstalledAt = T0;
    expect(await errorOf(exchange(client.client_id, back.searchParams.get("code")!))).toEqual([
      400,
      "invalid_grant",
    ]);
  });

  it("rotates refresh tokens and closes the connection when an old one is reused", async () => {
    const { client, access_token: a1, refresh_token: r1 } = await connect();
    const first = await refresh(client.client_id, r1, at(600));
    expect(first.status).toBe(200);
    const { access_token: a2, refresh_token: r2 } = first.body as Tokens;
    expect(r2).not.toBe(r1);
    expect((await bearer(a2, at(600))).ok).toBe(true);
    expect((await bearer(a1, at(600))).ok).toBe(false);

    // উত্তর হারিয়ে গেলে এক মিনিটের মধ্যে পুরনোটা দিয়ে আবার চাওয়া যায়
    const retry = await refresh(client.client_id, r1, at(630));
    expect(retry.status).toBe(200);
    const { access_token: a3, refresh_token: r3 } = retry.body as Tokens;
    expect((await bearer(a3, at(630))).ok).toBe(true);

    // তার পরে পুরনোটা এলে চুরি ধরে নিয়ে পুরো সংযোগ বন্ধ
    expect(await errorOf(refresh(client.client_id, r1, at(700)))).toEqual([400, "invalid_grant"]);
    expect((await bearer(a3, at(700))).ok).toBe(false);
    expect((await refresh(client.client_id, r3, at(700))).status).toBe(400);
  });

  it("keeps a refresh token to its assistant and its permissions", async () => {
    const { client, refresh_token } = await connect({ write: false });
    const other = await register({ client_name: "Other" });
    expect(await errorOf(refresh(other.client_id, refresh_token))).toEqual([400, "invalid_grant"]);
    expect(
      await errorOf(refresh(client.client_id, refresh_token, T0, { scope: "read write" })),
    ).toEqual([400, "invalid_scope"]);
    expect(await errorOf(refresh(client.client_id, "mcp_rt_unknown"))).toEqual([
      400,
      "invalid_grant",
    ]);
    expect(await errorOf(refresh(client.client_id, ""))).toEqual([400, "invalid_request"]);
    const password = form({ grant_type: "password", client_id: client.client_id });
    expect(await errorOf(oauth.tokenRequest(password, null, T0))).toEqual([
      400,
      "unsupported_grant_type",
    ]);
    // কিছুই বন্ধ হয়নি
    expect((await refresh(client.client_id, refresh_token, T0, { scope: "read" })).status).toBe(
      200,
    );
  });

  it("checks the client secret of assistants that have one", async () => {
    const client = await register({ token_endpoint_auth_method: "client_secret_basic" });
    expect(client.client_secret).toMatch(/^mcp_cs_/);
    expect(db.mcpClient.rows[0]!.secretHash).not.toBe(client.client_secret);
    const back = await consent(await consentRequest(client.client_id));
    const code = back.searchParams.get("code")!;
    const body = form({ grant_type: "authorization_code", code, code_verifier: VERIFIER });
    const basic = (secret: string) =>
      `Basic ${Buffer.from(`${client.client_id}:${encodeURIComponent(secret)}`).toString("base64")}`;

    const withoutSecret = await exchange(client.client_id, code);
    expect(withoutSecret).toMatchObject({ status: 401, body: { error: "invalid_client" } });
    const wrong = await oauth.tokenRequest(body, basic("mcp_cs_wrong"), T0);
    expect(wrong.status).toBe(401);
    expect(wrong.headers?.["WWW-Authenticate"]).toContain("Basic");
    expect((await oauth.tokenRequest(body, basic(client.client_secret!), T0)).status).toBe(200);
  });

  it("revokes only the asking assistant's tokens and answers the same either way", async () => {
    const { client, access_token, refresh_token } = await connect();
    const other = await register({ client_name: "Other" });
    const revoke = (token: string, clientId: string) =>
      oauth.revokeRequest(form({ token, client_id: clientId }), null, T0);
    expect(await revoke(refresh_token, other.client_id)).toEqual({ status: 200, body: {} });
    expect((await bearer(access_token)).ok).toBe(true);
    expect(await revoke("mcp_rt_unknown", client.client_id)).toEqual({ status: 200, body: {} });
    expect(await revoke(refresh_token, client.client_id)).toEqual({ status: 200, body: {} });
    expect((await bearer(access_token)).ok).toBe(false);
    expect((await refresh(client.client_id, refresh_token)).status).toBe(400);
    expect(await oauth.listConnections(shop.id)).toEqual([]);
  });

  it("notes when a connection was last used without writing on every call", async () => {
    const created = await oauth.createAccessKey(shop.id, { name: "Script", write: false });
    if (!created.ok) throw new Error("no key");
    await bearer(created.key, T0);
    expect(db.mcpGrant.rows[0]!.lastUsedAt).toEqual(T0);
    await bearer(created.key, at(60));
    expect(db.mcpGrant.rows[0]!.lastUsedAt).toEqual(T0);
    await bearer(created.key, at(301));
    expect(db.mcpGrant.rows[0]!.lastUsedAt).toEqual(at(301));
  });

  it("stops every token as soon as the app is uninstalled", async () => {
    const { access_token } = await connect();
    db.shop.rows[0]!.uninstalledAt = T0;
    expect(await bearer(access_token)).toEqual({ ok: false, error: "invalid" });
  });
});

describe("client registration", () => {
  it("accepts web, local and app return addresses but not dangerous ones", () => {
    const valid = [
      REDIRECT,
      "http://localhost:6274/oauth/callback",
      "http://127.0.0.1/callback",
      "cursor://anysphere.cursor-retrieval/oauth/user-callback",
    ];
    const invalid = [
      "http://example.com/callback",
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://claude.ai/cb#fragment",
      "https://user:pw@claude.ai/cb",
      42,
    ];
    expect(valid.filter((uri) => !oauth.validRedirectUri(uri))).toEqual([]);
    expect(invalid.filter((uri) => oauth.validRedirectUri(uri))).toEqual([]);

    const local = ["http://127.0.0.1/callback"];
    expect(oauth.redirectAllowed(local, "http://127.0.0.1:53682/callback")).toBe(true);
    expect(oauth.redirectAllowed(local, "http://127.0.0.1:53682/other")).toBe(false);
    expect(oauth.redirectAllowed([REDIRECT], `${REDIRECT}2`)).toBe(false);
    expect(oauth.redirectAllowed([REDIRECT], REDIRECT)).toBe(true);
  });

  it("refuses bad registrations", async () => {
    const error = async (meta: unknown) => (await oauth.registerClient(meta, IP, T0)).body.error;
    expect(await error({ redirect_uris: ["javascript:alert(1)"] })).toBe("invalid_redirect_uri");
    expect(await error({ redirect_uris: [] })).toBe("invalid_redirect_uri");
    expect(await error({ redirect_uris: [REDIRECT], grant_types: ["implicit"] })).toBe(
      "invalid_client_metadata",
    );
    expect(
      await error({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "private_key_jwt" }),
    ).toBe("invalid_client_metadata");
    expect(await error([REDIRECT])).toBe("invalid_client_metadata");
    expect(db.mcpClient.rows).toHaveLength(0);
  });

  it("cleans the name an assistant gives itself", async () => {
    expect((await register({ client_name: "Bad\u0007Name" })).client_name).toBe("BadName");
    expect((await register({ client_name: undefined })).client_name).toBe("claude.ai");
  });

  it("limits registrations from one address", async () => {
    for (let i = 0; i < 20; i++) await register();
    const reply = await oauth.registerClient({ redirect_uris: [REDIRECT] }, IP, T0);
    expect(reply.status).toBe(429);
  });
});

describe("client metadata documents", () => {
  const DOC = "https://chatgpt.com/oauth/client.json";
  const CALLBACK = "https://chatgpt.com/connector_platform_oauth_redirect";

  it("reads the assistant's own document and shows where it came from", async () => {
    let fetches = 0;
    oauth.setClientFetchForTests(async (url) => {
      fetches++;
      return {
        status: 200,
        body: JSON.stringify({ client_id: url, client_name: "ChatGPT", redirect_uris: [CALLBACK] }),
      };
    });
    const requestId = await consentRequest(DOC, { redirect_uri: CALLBACK });
    expect(await oauth.consentView(requestId, shop.id, T0)).toMatchObject({
      clientName: "ChatGPT",
      verifiedHost: "chatgpt.com",
      returnTo: "chatgpt.com",
    });
    const back = await consent(requestId);
    expect((await exchange(DOC, back.searchParams.get("code")!)).status).toBe(200);
    expect(fetches).toBe(1);
    expect(await oauth.listConnections(shop.id)).toMatchObject([
      { kind: "oauth", name: "ChatGPT", verifiedHost: "chatgpt.com", write: true },
    ]);

    // পরে document পড়া না গেলে শেষ ভালো কপি দিয়ে চলে
    oauth.setClientFetchForTests(async () => ({ status: 500, body: "" }));
    expect(await oauth.resolveClient(DOC, at(2 * 86_400))).toMatchObject({ name: "ChatGPT" });
  });

  it("refuses a document that names another client", async () => {
    oauth.setClientFetchForTests(async () => ({
      status: 200,
      body: JSON.stringify({
        client_id: "https://evil.example/client.json",
        client_name: "ChatGPT",
        redirect_uris: [CALLBACK],
      }),
    }));
    expect(await authorize(DOC, { redirect_uri: CALLBACK })).toMatchObject({ kind: "error" });
    expect(db.mcpClient.rows).toHaveLength(0);
    expect(oauth.isClientDocumentUrl(DOC)).toBe(true);
    expect(oauth.isClientDocumentUrl("https://chatgpt.com/")).toBe(false);
    expect(oauth.isClientDocumentUrl("http://chatgpt.com/client.json")).toBe(false);
  });
});

describe("connections and keys", () => {
  it("creates keys that are shown once, last until removed and stay with their store", async () => {
    const created = await oauth.createAccessKey(shop.id, { name: "Grok", write: false });
    if (!created.ok) throw new Error("no key");
    expect(created.key).toMatch(/^mcp_key_/);
    const result = await bearer(created.key, at(400 * 86_400));
    expect(result.ok && result.grant.scopes).toEqual(["read"]);
    expect(JSON.stringify(db.mcpGrant.rows)).not.toContain(created.key);
    expect(await oauth.listConnections(shop.id)).toMatchObject([
      {
        kind: "key",
        name: "Grok",
        write: false,
        keyHint: created.key.slice(-4),
        verifiedHost: null,
      },
    ]);

    for (let i = 0; i < 9; i++)
      await oauth.createAccessKey(shop.id, { name: `Key ${i}`, write: true });
    expect(await oauth.createAccessKey(shop.id, { name: "One more", write: true })).toEqual({
      ok: false,
      error: "too_many",
    });

    const other = db.shop.seed({ domain: "b.myshopify.com" });
    expect(await oauth.disconnect(other.id as string, created.id, T0)).toBe(false);
    expect(await oauth.disconnect(shop.id, created.id, T0)).toBe(true);
    expect((await bearer(created.key)).ok).toBe(false);
    expect((await oauth.createAccessKey(shop.id, { name: "Again", write: false })).ok).toBe(true);
  });

  it("cancels the waiting requests of an assistant that is disconnected", async () => {
    const created = await oauth.createAccessKey(shop.id, { name: "Script", write: true });
    if (!created.ok) throw new Error("no key");
    const waiting = { shopId: shop.id, assistant: "x", tool: "t", input: {}, expiresAt: at(3600) };
    db.mcpAction.seed({ ...waiting, grantId: created.id });
    db.mcpAction.seed({ ...waiting, grantId: "someone-else" });
    await oauth.disconnect(shop.id, created.id, T0);
    expect(db.mcpAction.rows.map((row) => row.status)).toEqual(["expired", "pending"]);
  });

  it("closes everything when the app is uninstalled", async () => {
    const { access_token } = await connect();
    const created = await oauth.createAccessKey(shop.id, { name: "Script", write: true });
    if (!created.ok) throw new Error("no key");
    db.mcpAction.seed({
      shopId: shop.id,
      assistant: "Claude",
      tool: "request_feature_change",
      input: {},
      expiresAt: at(3600),
    });
    await oauth.disconnectAll(shop.id, T0);
    expect((await bearer(access_token)).ok).toBe(false);
    expect((await bearer(created.key)).ok).toBe(false);
    expect(db.mcpAction.rows[0]).toMatchObject({
      status: "expired",
      error: "The app was uninstalled",
    });
    expect(await oauth.listConnections(shop.id)).toEqual([]);
  });

  it("cleans up old rows", async () => {
    const hoursAgo = (n: number) => new Date(T0.getTime() - n * 3_600_000);
    const request = {
      clientId: "c",
      redirectUri: REDIRECT,
      codeChallenge: CHALLENGE,
      scopes: ["read"],
      resource: "",
      expiresAt: T0,
    };
    db.mcpAuthRequest.seed({ ...request, createdAt: hoursAgo(25) });
    db.mcpAuthRequest.seed({ ...request, createdAt: hoursAgo(1) });
    const grant = { shopId: shop.id, kind: "oauth", scopes: ["read"] };
    db.mcpGrant.seed({ ...grant, name: "old", revokedAt: hoursAgo(31 * 24) });
    db.mcpGrant.seed({
      ...grant,
      name: "kept",
      clientId: "mcp_client_used",
      revokedAt: hoursAgo(24),
    });
    const action = { shopId: shop.id, assistant: "x", tool: "t", input: {}, expiresAt: at(3600) };
    db.mcpAction.seed({ ...action, expiresAt: hoursAgo(1) });
    db.mcpAction.seed({ ...action, status: "running", decidedAt: hoursAgo(2) });
    db.mcpAction.seed({ ...action, status: "done", createdAt: hoursAgo(91 * 24) });
    const client = { kind: "dcr", name: "x", redirectUris: [REDIRECT] };
    db.mcpClient.seed({ ...client, clientId: "mcp_client_stale", createdAt: hoursAgo(31 * 24) });
    db.mcpClient.seed({ ...client, clientId: "mcp_client_used", createdAt: hoursAgo(31 * 24) });
    db.mcpClient.seed({ ...client, clientId: "mcp_client_new", createdAt: hoursAgo(1) });

    await oauth.pruneMcp(T0);
    expect(db.mcpAuthRequest.rows).toHaveLength(1);
    expect(db.mcpGrant.rows.map((row) => row.name)).toEqual(["kept"]);
    expect(db.mcpAction.rows.map((row) => row.status)).toEqual(["expired", "failed"]);
    expect(db.mcpClient.rows.map((row) => row.clientId)).toEqual([
      "mcp_client_used",
      "mcp_client_new",
    ]);
  });
});
