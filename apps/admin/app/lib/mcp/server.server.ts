import { z } from "zod";
import { brand } from "@app/brand";
import { allowRequest } from "../rate-limit.server";
import { planOf } from "../shop.server";
import { McpToolError } from "./actions.server";
import { CORS_HEADERS, jsonReply, methodNotAllowed, preflight, readBody } from "./http.server";
import { MCP_SCOPES, authenticateBearer, isMcpId, resourceMetadataUrl } from "./oauth.server";
import { MCP_TOOLS, inputSchema, toolsFor, type McpTool, type ToolContext } from "./tools.server";

/**
 * স্টোরের MCP ঠিকানা (/mcp/<id>): Streamable HTTP, তবে শুধু JSON উত্তর আর কোনো session নেই।
 * প্রতিটা অনুরোধ নিজেই সম্পূর্ণ (টোকেন + সংস্করণ হেডার), তাই একাধিক সার্ভারেও চলে।
 * 2026-07-28 সংস্করণের ক্লায়েন্ট সমর্থিত তালিকা দেখে পুরনো (initialize) পথে আসে।
 */
export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
const LATEST = SUPPORTED_VERSIONS[0];
/** হেডার ছাড়া এলে স্পেক অনুযায়ী এই সংস্করণ ধরা হয় */
const ASSUMED_VERSION = "2025-03-26";
const MAX_BODY = 256 * 1024;
const MAX_BATCH = 20;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

type RpcId = string | number;
type Context = ToolContext & { version: string };

class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const validId = (value: unknown): value is RpcId =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

const rpcError = (id: RpcId | null, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0" as const,
  id,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

const isSupported = (version: string) =>
  (SUPPORTED_VERSIONS as readonly string[]).includes(version);

/** DNS rebinding থেকে বাঁচতে: ব্রাউজার থেকে এলে origin হতে হবে https, বা নিজের কম্পিউটারের http */
function originAllowed(origin: string | null): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  } catch {
    return false;
  }
}

function unauthorized(mcpId: string, error: "missing" | "invalid") {
  // টোকেনই না থাকলে error বলা হয় না (RFC 6750 §3.1)
  const parts = [
    ...(error === "invalid"
      ? ['error="invalid_token"', 'error_description="The access token is expired or revoked"']
      : []),
    `resource_metadata="${resourceMetadataUrl(mcpId)}"`,
    `scope="${MCP_SCOPES.join(" ")}"`,
  ];
  return jsonReply(
    {
      error: error === "invalid" ? "invalid_token" : "unauthorized",
      error_description: "Connect this assistant to the store first",
    },
    401,
    { "WWW-Authenticate": `Bearer ${parts.join(", ")}` },
  );
}

function instructions(ctx: Context) {
  const write = ctx.grant.scopes.includes("write");
  return [
    `You are connected to the Shopify store ${ctx.shop.domain} through the ${brand.name} app.`,
    "Read tools give sales and visitor reports, app features, offers, product reviews, AI search visibility and email marketing numbers. Shopper emails and full names are never shared.",
    write
      ? "request_* tools never change the store directly: each one creates a change request that the store owner approves in the app. Always share the approval link and say that nothing has changed yet."
      : "This connection can only read; it cannot ask for changes.",
  ].join(" ");
}

function describeTool(item: McpTool) {
  const read = item.scope === "read";
  return {
    name: item.name,
    title: item.title,
    description: item.description,
    inputSchema: inputSchema(item),
    annotations: {
      title: item.title,
      readOnlyHint: read,
      // request_* শুধু অনুরোধ রাখে; আসল পরিবর্তন মার্চেন্ট অনুমোদন দিলে
      destructiveHint: false,
      idempotentHint: read,
      openWorldHint: false,
    },
  };
}

const toolText = (message: string) => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

async function callTool(params: unknown, ctx: Context) {
  if (!isObject(params) || typeof params.name !== "string") {
    throw new RpcError(-32602, "Invalid params: name is required");
  }
  const item = MCP_TOOLS.find((candidate) => candidate.name === params.name);
  if (!item) throw new RpcError(-32602, `Unknown tool: ${params.name}`);
  if (!ctx.grant.scopes.includes(item.scope)) {
    return toolText(
      "This connection can only read. To ask for changes, connect the assistant again and allow change requests.",
    );
  }
  // প্ল্যান বদলালে (যেমন Starter-এ নামলে) সংযোগ থাকে, তবে কাজ থামে
  if (planOf(ctx.shop) !== "professional") {
    return toolText(
      "AI assistant access needs the Professional plan. The store owner can upgrade on the app's Plans page.",
    );
  }
  const parsed = item.input.safeParse(params.arguments ?? {});
  if (!parsed.success) return toolText(`Invalid arguments:\n${z.prettifyError(parsed.error)}`);
  try {
    const result = await item.run(parsed.data, ctx);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      // structuredContent 2025-06-18 সংস্করণে এসেছে
      ...(ctx.version >= "2025-06-18" ? { structuredContent: result } : {}),
    };
  } catch (error) {
    if (error instanceof McpToolError) return toolText(error.message);
    console.error(`[mcp] ${item.name} failed`, error);
    return toolText("Something went wrong while reading the store. Try again in a moment.");
  }
}

async function dispatch(method: string, params: unknown, ctx: Context): Promise<unknown> {
  switch (method) {
    case "initialize": {
      const asked = isObject(params) ? params.protocolVersion : undefined;
      return {
        // ক্লায়েন্টের সংস্করণ চললে সেটাই, নইলে আমাদের সবচেয়ে নতুনটা (ক্লায়েন্ট ঠিক করবে চলবে কিনা)
        protocolVersion: typeof asked === "string" && isSupported(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: `${brand.slug}-shopify`,
          title: `${brand.name} for Shopify`,
          version: "1.0.0",
        },
        instructions: instructions(ctx),
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolsFor(ctx.grant.scopes).map(describeTool) };
    case "tools/call":
      return callTool(params, ctx);
    default:
      throw new RpcError(-32601, `Method not found: ${method}`);
  }
}

async function handleMessage(message: unknown, ctx: Context) {
  if (!isObject(message) || message.jsonrpc !== "2.0") {
    return rpcError(null, -32600, "Invalid request");
  }
  // ক্লায়েন্টের পাঠানো উত্তর (আমরা কখনো অনুরোধ পাঠাই না) বা notification: উত্তর লাগে না
  if (typeof message.method !== "string") return null;
  if (message.id === undefined) return null;
  if (!validId(message.id)) return rpcError(null, -32600, "Invalid request id");
  try {
    return {
      jsonrpc: "2.0" as const,
      id: message.id,
      result: await dispatch(message.method, message.params, ctx),
    };
  } catch (error) {
    if (error instanceof RpcError)
      return rpcError(message.id, error.code, error.message, error.data);
    console.error("[mcp] request failed", error);
    return rpcError(message.id, -32603, "Internal error");
  }
}

export async function handleMcpRequest(
  request: Request,
  mcpId: string,
  now = new Date(),
): Promise<Response> {
  if (request.method === "OPTIONS") return preflight();
  // GET-এর SSE stream বা DELETE-এর session নেই
  if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
  if (!originAllowed(request.headers.get("origin"))) {
    return jsonReply(rpcError(null, -32600, "Origin not allowed"), 403);
  }
  if (!isMcpId(mcpId)) return jsonReply(rpcError(null, -32600, "Not found"), 404);
  const auth = await authenticateBearer(request.headers.get("authorization"), mcpId, now);
  if (!auth.ok) return unauthorized(mcpId, auth.error);
  if (!allowRequest(`mcp:${auth.grant.id}`, 120, 60_000)) {
    return jsonReply(rpcError(null, -32000, "Too many requests. Wait a minute."), 429, {
      "Retry-After": "60",
    });
  }

  const text = await readBody(request, MAX_BODY);
  if (text === null) return jsonReply(rpcError(null, -32600, "Request is too large"), 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonReply(rpcError(null, -32700, "Parse error"), 400);
  }
  const messages = Array.isArray(body) ? body : [body];
  if (messages.length === 0 || messages.length > MAX_BATCH) {
    return jsonReply(rpcError(null, -32600, "Invalid request"), 400);
  }

  // সংস্করণ মেলানো initialize-এর ভেতরে হয়; বাকি সব অনুরোধে হেডারের সংস্করণ সমর্থিত হতে হবে
  const header = request.headers.get("mcp-protocol-version");
  const initializeOnly = messages.every((m) => isObject(m) && m.method === "initialize");
  if (header && !initializeOnly && !isSupported(header)) {
    const first = messages[0];
    const id = messages.length === 1 && isObject(first) && validId(first.id) ? first.id : null;
    return jsonReply(
      rpcError(id, -32022, "Unsupported protocol version", {
        supported: [...SUPPORTED_VERSIONS],
        requested: header,
      }),
      400,
    );
  }
  const ctx: Context = {
    shop: auth.shop,
    grant: auth.grant,
    now,
    version: header && isSupported(header) ? header : ASSUMED_VERSION,
  };

  const replies = [];
  for (const message of messages) {
    const reply = await handleMessage(message, ctx);
    if (reply) replies.push(reply);
  }
  if (replies.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return jsonReply(Array.isArray(body) ? replies : replies[0]);
}
