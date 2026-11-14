import { randomBytes } from "node:crypto";
import type { McpClient, McpGrant, Shop } from "@prisma/client";
import { brand } from "@app/brand";
import db from "../../db.server";
import { sign, verify } from "../crypto.server";
import { appUrl } from "../links.server";
import { allowRequest } from "../rate-limit.server";
import { safeFetch } from "../safe-fetch.server";
import {
  PREFIX,
  hashToken,
  isS256Challenge,
  newToken,
  pkceMatches,
  sameText,
} from "./tokens.server";

/**
 * AI সহকারীর (ChatGPT, Claude, Gemini, Grok ...) লগইন: OAuth 2.1, MCP-র নিয়মে।
 *
 * ১. সহকারী /mcp/<id>-এ গিয়ে 401 পায়, সেখান থেকে এই সার্ভারের ঠিকানাগুলো জানে (RFC 9728, RFC 8414)।
 * ২. নিজেকে নথিভুক্ত করে (RFC 7591), অথবা নিজের https ঠিকানাকেই client_id হিসেবে দেয় (Client ID Metadata Document)।
 * ৩. মার্চেন্টকে /oauth/authorize-এ পাঠায়। আমরা তাকে তার Shopify অ্যাডমিনে আমাদের অ্যাপের সম্মতির পাতায় নিই,
 *    তাই আলাদা পাসওয়ার্ড লাগে না: অ্যাডমিনে লগইন থাকাই প্রমাণ যে তিনি স্টোরের লোক।
 * ৪. সম্মতির পর এক-বারের code, PKCE (S256) দিয়ে সেটা টোকেনে বদলায়। access token এক ঘণ্টা,
 *    refresh token প্রতিবার বদলায়; পুরনোটা আবার এলে (চুরির লক্ষণ) পুরো সংযোগ বন্ধ।
 *
 * যে সহকারী শুধু একটা স্থায়ী টোকেন নিতে পারে, তার জন্য মার্চেন্ট অ্যাপে "চাবি" বানান (kind "key")।
 */
export const MCP_SCOPES = ["read", "write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const ACCESS_TOKEN_SECONDS = 60 * 60;
/** সম্মতির পর code (আর সম্মতি থেকে ফেরার লিংক) কতক্ষণ চলে */
const CODE_SECONDS = 5 * 60;
/** মার্চেন্ট কতক্ষণের মধ্যে সম্মতি দিতে পারেন (অ্যাডমিনে লগইন করতে সময় লাগতে পারে) */
const REQUEST_SECONDS = 15 * 60;
/** refresh token বদলের পরে পুরনোটা কতক্ষণ চলে (উত্তর হারিয়ে গেলে ক্লায়েন্ট আবার পাঠায়) */
const REFRESH_GRACE_MS = 60_000;
/** ক্লায়েন্টের metadata document দিনে একবার নতুন করে পড়া হয় */
const CLIENT_DOC_TTL_MS = 24 * 60 * 60_000;
const MAX_KEYS = 10;
const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"];
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** নেটিভ অ্যাপের নিজস্ব scheme (cursor:// ইত্যাদি) চলে, তবে এগুলো নয় */
const BLOCKED_SCHEMES = new Set([
  "javascript",
  "data",
  "file",
  "vbscript",
  "about",
  "blob",
  "filesystem",
  "ftp",
  "ws",
  "wss",
  "mailto",
  "tel",
  "sms",
  "intent",
  "chrome",
  "view-source",
]);

export interface OAuthReply {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

const oauthError = (
  status: number,
  error: string,
  description: string,
  headers?: Record<string, string>,
): OAuthReply => ({ status, body: { error, error_description: description }, headers });

// ---------- ঠিকানা ----------

export const issuer = () => appUrl();
export const mcpServerUrl = (mcpId: string) => `${appUrl()}/mcp/${mcpId}`;
export const resourceMetadataUrl = (mcpId: string) =>
  `${appUrl()}/.well-known/oauth-protected-resource/mcp/${mcpId}`;
/** স্টোরের অ্যাডমিনে আমাদের অ্যাপের একটা পাতা (Shopify নিজে লগইন দেখে, তারপর অ্যাপ খোলে) */
export const adminAppUrl = (shopDomain: string, path: string) =>
  `https://${shopDomain}/admin/apps/${process.env.SHOPIFY_API_KEY ?? ""}${path}`;
export const isMcpId = (value: string) => /^[A-Za-z0-9_-]{16,64}$/.test(value);

/** স্টোরের MCP ঠিকানার এলোমেলো অংশ; প্রথমবার লাগলে তৈরি হয় আর পরে বদলায় না */
export async function ensureMcpId(shop: { id: string; mcpId: string | null }): Promise<string> {
  if (shop.mcpId) return shop.mcpId;
  await db.shop.updateMany({
    where: { id: shop.id, mcpId: null },
    data: { mcpId: randomBytes(12).toString("base64url") },
  });
  const row = await db.shop.findUniqueOrThrow({ where: { id: shop.id }, select: { mcpId: true } });
  if (!row.mcpId) throw new Error("Could not create the assistant address");
  return row.mcpId;
}

export function authorizationServerMetadata() {
  const base = appUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: AUTH_METHODS,
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

export function protectedResourceMetadata(resource: string) {
  return {
    resource,
    authorization_servers: [issuer()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: `${brand.name} for Shopify`,
  };
}

/** চাওয়া অনুমতি: অজানাগুলো বাদ, ফাঁকা হলে সব (মার্চেন্ট সম্মতির পাতায় "পরিবর্তনের অনুরোধ" বাদ দিতে পারেন) */
export function parseScopes(raw: string | null | undefined): McpScope[] {
  const asked = (raw ?? "").split(/\s+/).filter(Boolean);
  const known = MCP_SCOPES.filter((scope) => asked.includes(scope));
  if (known.length === 0) return [...MCP_SCOPES];
  // পরিবর্তনের অনুরোধ করতেও আগে দেখতে হয়
  return known.includes("read") ? known : ["read", ...known];
}

// ---------- ক্লায়েন্ট ----------

function cleanName(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/\p{Cc}/gu, "")
        .trim()
        .slice(0, 80)
    : "";
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** ফিরে যাওয়ার ঠিকানা: https, নিজের কম্পিউটারের http (CLI অ্যাপ), বা নেটিভ অ্যাপের নিজস্ব scheme */
export function validRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 500 || raw.includes("#")) return false;
  const url = parseUrl(raw);
  if (!url || url.username || url.password) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  const scheme = url.protocol.slice(0, -1);
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) && !BLOCKED_SCHEMES.has(scheme);
}

/** নথিভুক্ত ঠিকানার সাথে হুবহু মিল; নিজের কম্পিউটারের ঠিকানায় যেকোনো port চলে (RFC 8252 §7.3) */
export function redirectAllowed(registered: string[], given: string): boolean {
  if (registered.includes(given)) return true;
  const url = parseUrl(given);
  if (!url || url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) return false;
  return registered.some((raw) => {
    const known = parseUrl(raw);
    return (
      known?.protocol === "http:" &&
      known.hostname === url.hostname &&
      known.pathname === url.pathname &&
      known.search === url.search
    );
  });
}

/** সম্মতির পাতায় দেখানোর মতো ছোট নাম: host, না থাকলে scheme */
export function redirectLabel(raw: string): string {
  const url = parseUrl(raw);
  if (!url) return raw.slice(0, 60);
  return url.host || url.protocol.replace(/:$/, "");
}

/** client_id যদি https ঠিকানা হয় (path সহ), তবে সেটা ক্লায়েন্টের নিজের metadata document */
export function isClientDocumentUrl(clientId: string): boolean {
  if (clientId.length > 500) return false;
  const url = parseUrl(clientId);
  return Boolean(
    url &&
    url.protocol === "https:" &&
    url.pathname !== "/" &&
    !clientId.includes("#") &&
    !url.username &&
    !url.password,
  );
}

export interface ClientInfo {
  clientId: string;
  kind: "dcr" | "cimd";
  name: string;
  redirectUris: string[];
  authMethod: string;
  secretHash: string | null;
}

const toInfo = (row: McpClient): ClientInfo => ({
  clientId: row.clientId,
  kind: row.kind === "cimd" ? "cimd" : "dcr",
  name: row.name,
  redirectUris: row.redirectUris,
  authMethod: row.authMethod,
  secretHash: row.secretHash,
});

type ClientFetch = (url: string) => Promise<{ status: number; body: string }>;
const defaultClientFetch: ClientFetch = async (url) => {
  // অন্যের ঠিকানায় ঘুরিয়ে দেওয়া চলে না; শুধু পাবলিক ঠিকানা (safeFetch)
  const reply = await safeFetch(url, { maxBytes: 20_000, timeoutMs: 5_000, maxRedirects: 0 });
  return { status: reply.status, body: reply.body };
};
let clientFetch = defaultClientFetch;

export function setClientFetchForTests(fn: ClientFetch | null) {
  clientFetch = fn ?? defaultClientFetch;
}

async function readClientDocument(clientId: string) {
  const host = parseUrl(clientId)?.host ?? "";
  if (!allowRequest(`mcp-cimd:${host}`, 30, 60 * 60_000)) return null;
  let doc: unknown;
  try {
    const reply = await clientFetch(clientId);
    if (reply.status !== 200) return null;
    doc = JSON.parse(reply.body);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const meta = doc as Record<string, unknown>;
  // document-এর client_id হুবহু তার নিজের ঠিকানা হতে হবে, নইলে অন্য কেউ সেজে আসতে পারত
  if (meta.client_id !== clientId) return null;
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 20) return null;
  if (!uris.every(validRedirectUri)) return null;
  return { name: cleanName(meta.client_name) || host, redirectUris: uris as string[] };
}

export async function resolveClient(
  clientId: string,
  now = new Date(),
): Promise<ClientInfo | null> {
  if (!clientId || clientId.length > 500) return null;
  const row = await db.mcpClient.findUnique({ where: { clientId } });
  if (!isClientDocumentUrl(clientId)) return row?.kind === "dcr" ? toInfo(row) : null;
  if (row?.fetchedAt && now.getTime() - row.fetchedAt.getTime() < CLIENT_DOC_TTL_MS) {
    return toInfo(row);
  }
  const doc = await readClientDocument(clientId);
  // নতুন করে পড়া না গেলে শেষ ভালো কপি দিয়ে চলে
  if (!doc) return row ? toInfo(row) : null;
  const data = {
    kind: "cimd",
    name: doc.name,
    redirectUris: doc.redirectUris,
    authMethod: "none",
    secretHash: null,
    fetchedAt: now,
  };
  const saved = await db.mcpClient.upsert({
    where: { clientId },
    create: { clientId, ...data },
    update: data,
  });
  return toInfo(saved);
}

/** Dynamic Client Registration (RFC 7591) */
export async function registerClient(
  body: unknown,
  ip: string,
  now = new Date(),
): Promise<OAuthReply> {
  if (
    !allowRequest(`mcp-register:${ip}`, 20, 60 * 60_000) ||
    !allowRequest("mcp-register", 2_000, 60 * 60_000)
  ) {
    return oauthError(429, "invalid_client_metadata", "Too many registrations. Try again later.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return oauthError(400, "invalid_client_metadata", "Send the client metadata as a JSON object");
  }
  const meta = body as Record<string, unknown>;
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
    return oauthError(400, "invalid_redirect_uri", "Give 1 to 10 redirect_uris");
  }
  if (!uris.every(validRedirectUri)) {
    return oauthError(
      400,
      "invalid_redirect_uri",
      "redirect_uris must be https, http on localhost, or an app's own scheme",
    );
  }
  // RFC 7591: না বললে client_secret_basic
  const method = meta.token_endpoint_auth_method ?? "client_secret_basic";
  if (typeof method !== "string" || !AUTH_METHODS.includes(method)) {
    return oauthError(
      400,
      "invalid_client_metadata",
      `token_endpoint_auth_method must be one of: ${AUTH_METHODS.join(", ")}`,
    );
  }
  const listed = (value: unknown, needed: string) =>
    value === undefined || (Array.isArray(value) && value.includes(needed));
  if (!listed(meta.grant_types, "authorization_code") || !listed(meta.response_types, "code")) {
    return oauthError(
      400,
      "invalid_client_metadata",
      "Only the authorization_code flow with response_type code is supported",
    );
  }
  const redirectUris = uris as string[];
  const name = cleanName(meta.client_name) || redirectLabel(redirectUris[0]!) || "AI assistant";
  const clientId = newToken(PREFIX.client, 16);
  const secret = method === "none" ? null : newToken(PREFIX.secret);
  await db.mcpClient.create({
    data: {
      clientId,
      kind: "dcr",
      name,
      redirectUris,
      authMethod: method,
      secretHash: secret ? hashToken(secret) : null,
    },
  });
  return {
    status: 201,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: method,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: MCP_SCOPES.join(" "),
    },
  };
}

// ---------- সম্মতি ----------

function withParams(uri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

const consentUrl = (shopDomain: string, requestId: string) =>
  adminAppUrl(shopDomain, `/app/assistants/connect?request=${encodeURIComponent(requestId)}`);

/** resource (RFC 8707) থেকে স্টোর: নিজের স্টোরের MCP ঠিকানা, বা সাধারণ ঠিকানা (তখন মার্চেন্ট স্টোর বলে দেন) */
async function resourceShop(
  resource: string | null,
): Promise<{ shop: { id: string; domain: string } | null } | null> {
  if (!resource) return { shop: null };
  const base = appUrl();
  const clean = resource.replace(/\/+$/, "");
  if (clean === base || clean === `${base}/mcp`) return { shop: null };
  const prefix = `${base}/mcp/`;
  const mcpId = clean.startsWith(prefix) ? clean.slice(prefix.length) : "";
  if (!isMcpId(mcpId)) return null;
  const shop = await db.shop.findUnique({
    where: { mcpId },
    select: { id: true, domain: true, uninstalledAt: true },
  });
  return shop && !shop.uninstalledAt ? { shop: { id: shop.id, domain: shop.domain } } : null;
}

export type AuthorizeResult =
  | { kind: "redirect"; url: string }
  | { kind: "choose_store"; requestId: string; clientName: string }
  | { kind: "error"; message: string };

/** GET /oauth/authorize */
export async function startAuthorization(
  params: URLSearchParams,
  ip: string,
  now = new Date(),
): Promise<AuthorizeResult> {
  if (!allowRequest(`mcp-authorize:${ip}`, 30, 10 * 60_000)) {
    return { kind: "error", message: "Too many attempts. Wait a few minutes and try again." };
  }
  const client = await resolveClient(params.get("client_id") ?? "", now);
  if (!client) {
    return {
      kind: "error",
      message: "This assistant is not registered here. Start connecting again from the assistant.",
    };
  }
  const given = params.get("redirect_uri");
  const redirectUri = given ?? (client.redirectUris.length === 1 ? client.redirectUris[0]! : "");
  // ভুল ফেরার ঠিকানায় কখনো পাঠানো হয় না (এমনকি ভুলের খবরও না)
  if (!redirectUri || !redirectAllowed(client.redirectUris, redirectUri)) {
    return {
      kind: "error",
      message: "The return address does not match this assistant's registration.",
    };
  }
  const state = params.get("state");
  const fail = (error: string, description: string): AuthorizeResult => ({
    kind: "redirect",
    url: withParams(redirectUri, { error, error_description: description, state, iss: issuer() }),
  });
  if (params.get("response_type") !== "code") {
    return fail("unsupported_response_type", "Only response_type=code is supported");
  }
  const challenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !isS256Challenge(challenge)) {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  if ((state ?? "").length > 1_000) return fail("invalid_request", "state is too long");
  const resources = params.getAll("resource");
  if (resources.length > 1) return fail("invalid_target", "Ask for one resource at a time");
  const target = await resourceShop(resources[0] ?? null);
  if (!target) return fail("invalid_target", "Unknown resource");

  const request = await db.mcpAuthRequest.create({
    data: {
      clientId: client.clientId,
      redirectUri,
      state,
      codeChallenge: challenge,
      scopes: parseScopes(params.get("scope")),
      resource: resources[0] ?? "",
      shopId: target.shop?.id ?? null,
      expiresAt: new Date(now.getTime() + REQUEST_SECONDS * 1000),
    },
  });
  if (target.shop) return { kind: "redirect", url: consentUrl(target.shop.domain, request.id) };
  return { kind: "choose_store", requestId: request.id, clientName: client.name };
}

/** "mystore", "mystore.myshopify.com", অ্যাডমিনের লিংক → mystore.myshopify.com; না মিললে null */
export function normalizeShopDomain(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  const admin = /admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/.exec(value);
  let host = admin
    ? `${admin[1]}.myshopify.com`
    : (value.replace(/^https?:\/\//, "").split(/[/?#]/)[0] ?? "");
  if (host && !host.includes(".")) host = `${host}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(host) ? host : null;
}

/** স্টোর বেছে নেওয়ার পাতার জন্য: অনুরোধটা এখনো স্টোর ছাড়া অপেক্ষায় থাকলে সহকারীর নাম */
export async function pendingStoreRequest(requestId: string, now = new Date()) {
  const request = requestId
    ? await db.mcpAuthRequest.findUnique({ where: { id: requestId } })
    : null;
  if (!request || request.status !== "pending" || request.shopId || request.expiresAt <= now) {
    return null;
  }
  const client = await db.mcpClient.findUnique({
    where: { clientId: request.clientId },
    select: { name: true },
  });
  return client ? { clientName: client.name } : null;
}

/** সাধারণ ঠিকানা দিয়ে শুরু হলে: মার্চেন্টের লেখা স্টোরের অ্যাডমিনে সম্মতির পাতা */
export async function storeConsentUrl(
  requestId: string,
  rawShop: string,
  now = new Date(),
): Promise<string | null> {
  const domain = normalizeShopDomain(rawShop);
  if (!domain) return null;
  const request = await db.mcpAuthRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status !== "pending" || request.shopId || request.expiresAt <= now) {
    return null;
  }
  return consentUrl(domain, request.id);
}

export type ConsentProblem = "not_found" | "expired" | "used" | "other_store";

type AuthRequestRow = Awaited<ReturnType<typeof db.mcpAuthRequest.findUnique>>;

function consentProblem(request: AuthRequestRow, shopId: string, now: Date): ConsentProblem | null {
  if (!request) return "not_found";
  if (request.status !== "pending") return "used";
  if (request.expiresAt <= now) return "expired";
  if (request.shopId && request.shopId !== shopId) return "other_store";
  return null;
}

/** অ্যাডমিনের সম্মতির পাতার জন্য: কে চাইছে, কী চাইছে, কোথায় ফিরবে */
export async function consentView(requestId: string, shopId: string, now = new Date()) {
  const request = await db.mcpAuthRequest.findUnique({ where: { id: requestId } });
  const problem = consentProblem(request, shopId, now);
  if (problem || !request) return { problem: problem ?? "not_found" } as const;
  const client = await db.mcpClient.findUnique({ where: { clientId: request.clientId } });
  if (!client) return { problem: "not_found" } as const;
  return {
    problem: null,
    requestId: request.id,
    clientName: client.name,
    /** metadata document যে ঠিকানা থেকে এসেছে (যেমন chatgpt.com): নামটা সেখান থেকেই নিশ্চিত */
    verifiedHost: client.kind === "cimd" ? (parseUrl(client.clientId)?.host ?? null) : null,
    returnTo: redirectLabel(request.redirectUri),
    write: request.scopes.includes("write"),
  } as const;
}

/** সম্মতি বা না: পরের ধাপের লিংক (অ্যাডমিনের বাইরে, পুরো জানালায় খোলে) */
export async function decideConsent(
  requestId: string,
  shop: { id: string; mcpId: string | null },
  decision: { allow: boolean; write: boolean },
  now = new Date(),
): Promise<{ next: string } | { problem: ConsentProblem }> {
  const request = await db.mcpAuthRequest.findUnique({ where: { id: requestId } });
  const problem = consentProblem(request, shop.id, now);
  if (problem || !request) return { problem: problem ?? "not_found" };
  await ensureMcpId(shop);
  const scopes = request.scopes.filter(
    (scope) => scope === "read" || (scope === "write" && decision.write),
  );
  const claimed = await db.mcpAuthRequest.updateMany({
    where: { id: request.id, status: "pending" },
    data: {
      status: decision.allow ? "approved" : "denied",
      shopId: shop.id,
      scopes: scopes.length > 0 ? scopes : ["read"],
      expiresAt: new Date(now.getTime() + CODE_SECONDS * 1000),
    },
  });
  if (claimed.count === 0) return { problem: "used" };
  const sig = sign("mcp-complete", request.id);
  return {
    next: `${appUrl()}/oauth/complete?request=${encodeURIComponent(request.id)}&sig=${sig}`,
  };
}

/**
 * GET /oauth/complete: সম্মতির পর সহকারীর ঠিকানায় ফেরার লিংক (code সহ, বা access_denied)।
 * code ঠিক এখানেই তৈরি হয় আর একবারই দেওয়া হয়। লিংকটা সই করা, তাই শুধু সম্মতির পাতাই এটা বানাতে পারে।
 */
export async function completeAuthorization(
  requestId: string,
  signature: string,
  now = new Date(),
): Promise<string | null> {
  if (!requestId || !signature || !verify("mcp-complete", requestId, signature)) return null;
  const request = await db.mcpAuthRequest.findUnique({ where: { id: requestId } });
  if (!request || request.expiresAt <= now) return null;
  const extra = { state: request.state, iss: issuer() };
  if (request.status === "denied") {
    const closed = await db.mcpAuthRequest.updateMany({
      where: { id: request.id, status: "denied" },
      data: { status: "closed" },
    });
    return closed.count === 1
      ? withParams(request.redirectUri, {
          error: "access_denied",
          error_description: "The store owner did not allow access",
          ...extra,
        })
      : null;
  }
  if (request.status !== "approved") return null;
  const code = newToken(PREFIX.code);
  const issued = await db.mcpAuthRequest.updateMany({
    where: { id: request.id, status: "approved" },
    data: {
      status: "issued",
      codeHash: hashToken(code),
      expiresAt: new Date(now.getTime() + CODE_SECONDS * 1000),
    },
  });
  return issued.count === 1 ? withParams(request.redirectUri, { code, ...extra }) : null;
}

// ---------- টোকেন ----------

interface ClientAuth {
  clientId: string;
  secret: string | null;
  basic: boolean;
}

function readClientAuth(form: URLSearchParams, authorization: string | null): ClientAuth | null {
  if (authorization && /^basic\s/i.test(authorization)) {
    const decoded = Buffer.from(authorization.replace(/^basic\s+/i, ""), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon < 1) return null;
    // RFC 6749 §2.3.1: দুটোই form-encoded
    const decode = (value: string) => {
      try {
        return decodeURIComponent(value.replace(/\+/g, " "));
      } catch {
        return value;
      }
    };
    return {
      clientId: decode(decoded.slice(0, colon)),
      secret: decode(decoded.slice(colon + 1)),
      basic: true,
    };
  }
  const clientId = form.get("client_id");
  return clientId ? { clientId, secret: form.get("client_secret"), basic: false } : null;
}

async function authenticateClient(
  form: URLSearchParams,
  authorization: string | null,
  now: Date,
): Promise<ClientInfo | OAuthReply> {
  const auth = readClientAuth(form, authorization);
  const invalid = oauthError(
    401,
    "invalid_client",
    "Client authentication failed",
    auth?.basic ? { "WWW-Authenticate": 'Basic realm="oauth"' } : undefined,
  );
  if (!auth) return invalid;
  const client = await resolveClient(auth.clientId, now);
  if (!client) return invalid;
  if (client.authMethod !== "none") {
    if (
      !auth.secret ||
      !client.secretHash ||
      !sameText(hashToken(auth.secret), client.secretHash)
    ) {
      return invalid;
    }
  }
  return client;
}

const tokenReply = (access: string, refresh: string, scopes: string[]): OAuthReply => ({
  status: 200,
  body: {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: refresh,
    scope: scopes.join(" "),
  },
});

const sameResource = (a: string, b: string) =>
  b !== "" && a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/** সংযোগ বন্ধ: টোকেন আর চলে না, আর এর চাওয়া অপেক্ষমাণ পরিবর্তনগুলো বাতিল */
async function revokeGrantById(id: string, now: Date) {
  await db.mcpGrant.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: now, accessHash: null, refreshHash: null, refreshPrevHash: null },
  });
  await db.mcpAction.updateMany({
    where: { grantId: id, status: "pending" },
    data: { status: "expired", error: "The assistant was disconnected", decidedAt: now },
  });
}

async function exchangeCode(form: URLSearchParams, client: ClientInfo, now: Date) {
  const invalid = (why: string) => oauthError(400, "invalid_grant", why);
  const code = form.get("code") ?? "";
  if (!code) return oauthError(400, "invalid_request", "code is missing");
  const request = await db.mcpAuthRequest.findUnique({ where: { codeHash: hashToken(code) } });
  if (!request) return invalid("Unknown or expired code");
  if (request.status === "used") {
    // একই code দুবার: চুরি হয়ে থাকতে পারে, তাই এই code থেকে দেওয়া সংযোগও বন্ধ (RFC 6749 §4.1.2)
    if (request.grantId) await revokeGrantById(request.grantId, now);
    return invalid("This code was already used");
  }
  if (request.status !== "issued" || request.expiresAt <= now) {
    return invalid("Unknown or expired code");
  }
  if (request.clientId !== client.clientId) return invalid("This code belongs to another client");
  const redirect = form.get("redirect_uri");
  if (redirect !== null && redirect !== request.redirectUri) {
    return invalid("redirect_uri does not match");
  }
  if (!pkceMatches(form.get("code_verifier") ?? "", request.codeChallenge)) {
    return invalid("code_verifier does not match");
  }
  const shop = request.shopId ? await db.shop.findUnique({ where: { id: request.shopId } }) : null;
  if (!shop || shop.uninstalledAt || !shop.mcpId) return invalid("The store is not available");
  const audience = mcpServerUrl(shop.mcpId);
  const resource = form.get("resource");
  if (
    resource !== null &&
    !sameResource(resource, audience) &&
    !sameResource(resource, request.resource)
  ) {
    return oauthError(400, "invalid_target", "resource does not match the authorization");
  }
  const used = await db.mcpAuthRequest.updateMany({
    where: { id: request.id, status: "issued" },
    data: { status: "used" },
  });
  if (used.count === 0) return invalid("This code was already used");

  const access = newToken(PREFIX.access);
  const refresh = newToken(PREFIX.refresh);
  const grant = await db.mcpGrant.create({
    data: {
      shopId: shop.id,
      kind: "oauth",
      clientId: client.clientId,
      name: client.name,
      scopes: request.scopes,
      resource: audience,
      accessHash: hashToken(access),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_SECONDS * 1000),
      refreshHash: hashToken(refresh),
    },
  });
  await db.mcpAuthRequest.update({ where: { id: request.id }, data: { grantId: grant.id } });
  return tokenReply(access, refresh, request.scopes);
}

async function refreshTokens(form: URLSearchParams, client: ClientInfo, now: Date) {
  const invalid = (why: string) => oauthError(400, "invalid_grant", why);
  const token = form.get("refresh_token") ?? "";
  if (!token) return oauthError(400, "invalid_request", "refresh_token is missing");
  const hash = hashToken(token);
  const find = () =>
    db.mcpGrant.findFirst({
      where: { OR: [{ refreshHash: hash }, { refreshPrevHash: hash }] },
      include: { shop: { select: { uninstalledAt: true } } },
    });
  let grant = await find();
  if (!grant || grant.kind !== "oauth" || grant.revokedAt) return invalid("Unknown refresh token");
  if (grant.clientId !== client.clientId) return invalid("This token belongs to another client");
  if (grant.shop.uninstalledAt) return invalid("The store is not available");
  const asked = (form.get("scope") ?? "").split(/\s+/).filter(Boolean);
  const scopes = grant.scopes;
  if (asked.some((scope) => !scopes.includes(scope))) {
    return oauthError(400, "invalid_scope", "A refresh cannot add permissions");
  }

  const access = newToken(PREFIX.access);
  const refresh = newToken(PREFIX.refresh);
  const fresh = {
    accessHash: hashToken(access),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_SECONDS * 1000),
    refreshHash: hashToken(refresh),
  };
  if (grant.refreshHash === hash) {
    const rotated = await db.mcpGrant.updateMany({
      where: { id: grant.id, refreshHash: hash, revokedAt: null },
      data: { ...fresh, refreshPrevHash: hash, refreshedAt: now },
    });
    if (rotated.count === 1) return tokenReply(access, refresh, scopes);
    // একই টোকেন দিয়ে আরেকটা অনুরোধ এইমাত্র বদলে দিয়েছে: নিচের পুরনো-টোকেনের নিয়মে
    grant = await find();
    if (!grant) return invalid("Unknown refresh token");
  }
  // পুরনো টোকেন: উত্তর হারিয়ে গেলে ক্লায়েন্ট আবার পাঠায়, তাই অল্প সময় চলে।
  // এর পরে এলে চুরি ধরে নিয়ে পুরো সংযোগ বন্ধ (OAuth 2.1-এর refresh token rotation)।
  if (
    grant.refreshPrevHash === hash &&
    grant.refreshedAt &&
    now.getTime() - grant.refreshedAt.getTime() <= REFRESH_GRACE_MS
  ) {
    const retried = await db.mcpGrant.updateMany({
      where: { id: grant.id, refreshPrevHash: hash, revokedAt: null },
      data: fresh,
    });
    if (retried.count === 1) return tokenReply(access, refresh, scopes);
  }
  await revokeGrantById(grant.id, now);
  return invalid("This refresh token was already used");
}

/** POST /oauth/token */
export async function tokenRequest(
  form: URLSearchParams,
  authorization: string | null,
  now = new Date(),
): Promise<OAuthReply> {
  const client = await authenticateClient(form, authorization, now);
  if ("status" in client) return client;
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") return exchangeCode(form, client, now);
  if (grantType === "refresh_token") return refreshTokens(form, client, now);
  return oauthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token");
}

/** POST /oauth/revoke (RFC 7009): অচেনা টোকেনেও 200, যাতে কিছু জানা না যায় */
export async function revokeRequest(
  form: URLSearchParams,
  authorization: string | null,
  now = new Date(),
): Promise<OAuthReply> {
  const client = await authenticateClient(form, authorization, now);
  if ("status" in client) return client;
  const token = form.get("token");
  if (!token) return oauthError(400, "invalid_request", "token is missing");
  const hash = hashToken(token);
  const grant = await db.mcpGrant.findFirst({
    where: { OR: [{ accessHash: hash }, { refreshHash: hash }, { refreshPrevHash: hash }] },
  });
  if (grant?.kind === "oauth" && grant.clientId === client.clientId) {
    await revokeGrantById(grant.id, now);
  }
  return { status: 200, body: {} };
}

// ---------- MCP ঠিকানায় টোকেন যাচাই ----------

export type BearerResult =
  { ok: true; grant: McpGrant; shop: Shop } | { ok: false; error: "missing" | "invalid" };

export async function authenticateBearer(
  authorization: string | null,
  mcpId: string,
  now = new Date(),
): Promise<BearerResult> {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  if (!match) return { ok: false, error: "missing" };
  const found = await db.mcpGrant.findUnique({
    where: { accessHash: hashToken(match[1]!) },
    include: { shop: true },
  });
  // টোকেন যে স্টোরের, শুধু সেই স্টোরের ঠিকানায় চলে (এটাই এর audience)
  if (!found || found.revokedAt || found.shop.uninstalledAt || found.shop.mcpId !== mcpId) {
    return { ok: false, error: "invalid" };
  }
  if (found.kind === "oauth" && (!found.accessExpiresAt || found.accessExpiresAt <= now)) {
    return { ok: false, error: "invalid" };
  }
  const { shop, ...grant } = found;
  // শেষ ব্যবহারের সময়, তবে প্রতি অনুরোধে লেখা নয়
  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() > 5 * 60_000) {
    await db.mcpGrant
      .update({ where: { id: grant.id }, data: { lastUsedAt: now } })
      .catch(() => undefined);
  }
  return { ok: true, grant, shop };
}

// ---------- অ্যাপের পাতা থেকে: সংযোগ আর চাবি ----------

export async function createAccessKey(shopId: string, input: { name: string; write: boolean }) {
  const active = await db.mcpGrant.count({ where: { shopId, kind: "key", revokedAt: null } });
  if (active >= MAX_KEYS) return { ok: false as const, error: "too_many" as const };
  const key = newToken(PREFIX.key);
  const grant = await db.mcpGrant.create({
    data: {
      shopId,
      kind: "key",
      name: cleanName(input.name) || "Access key",
      scopes: input.write ? ["read", "write"] : ["read"],
      accessHash: hashToken(key),
      keyHint: key.slice(-4),
    },
  });
  // চাবি শুধু এখন একবার দেখানো হয়; আমরা রাখি শুধু তার hash
  return { ok: true as const, key, id: grant.id };
}

export async function listConnections(shopId: string) {
  const rows = await db.mcpGrant.findMany({
    where: { shopId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((grant) => ({
    id: grant.id,
    kind: grant.kind === "key" ? ("key" as const) : ("oauth" as const),
    name: grant.name,
    write: grant.scopes.includes("write"),
    keyHint: grant.keyHint,
    verifiedHost:
      grant.clientId && isClientDocumentUrl(grant.clientId)
        ? (parseUrl(grant.clientId)?.host ?? null)
        : null,
    lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
  }));
}

export async function disconnect(shopId: string, grantId: string, now = new Date()) {
  const grant = await db.mcpGrant.findFirst({ where: { id: grantId, shopId, revokedAt: null } });
  if (grant) await revokeGrantById(grant.id, now);
  return Boolean(grant);
}

/** আনইনস্টল: সব সংযোগ বন্ধ, অপেক্ষমাণ পরিবর্তন বাতিল */
export async function disconnectAll(shopId: string, now = new Date()) {
  const grants = await db.mcpGrant.findMany({
    where: { shopId, revokedAt: null },
    select: { id: true },
  });
  for (const grant of grants) await revokeGrantById(grant.id, now);
  await db.mcpAction.updateMany({
    where: { shopId, status: "pending" },
    data: { status: "expired", error: "The app was uninstalled", decidedAt: now },
  });
}

/** পুরনো, আর কাজে লাগে না এমন সারি (jobs.server.ts-এর দৈনিক পরিষ্কার) */
export async function pruneMcp(now = new Date()) {
  const ago = (hours: number) => new Date(now.getTime() - hours * 60 * 60_000);
  await db.mcpAuthRequest.deleteMany({ where: { createdAt: { lt: ago(24) } } });
  await db.mcpGrant.deleteMany({ where: { revokedAt: { lt: ago(30 * 24) } } });
  await db.mcpAction.updateMany({
    where: { status: "pending", expiresAt: { lt: now } },
    data: { status: "expired", decidedAt: now },
  });
  // অনুমোদনের পর কাজ চলার সময় সার্ভার বন্ধ হলে
  await db.mcpAction.updateMany({
    where: { status: "running", decidedAt: { lt: ago(1) } },
    data: { status: "failed", error: "Interrupted. Ask the assistant again." },
  });
  await db.mcpAction.deleteMany({ where: { createdAt: { lt: ago(90 * 24) } } });
  // নথিভুক্ত হয়ে আর কখনো সংযোগ হয়নি এমন ক্লায়েন্ট (৩০ দিন)
  const stale = await db.mcpClient.findMany({
    where: { createdAt: { lt: ago(30 * 24) } },
    select: { id: true, clientId: true },
    take: 500,
  });
  if (stale.length === 0) return;
  const used = await db.mcpGrant.findMany({
    where: { clientId: { in: stale.map((client) => client.clientId) } },
    select: { clientId: true },
  });
  const keep = new Set(used.map((grant) => grant.clientId));
  const drop = stale.filter((client) => !keep.has(client.clientId)).map((client) => client.id);
  if (drop.length > 0) await db.mcpClient.deleteMany({ where: { id: { in: drop } } });
}
