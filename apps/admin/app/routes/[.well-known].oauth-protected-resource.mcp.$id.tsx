import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { jsonReply, preflight } from "../lib/mcp/http.server";
import { isMcpId, mcpServerUrl, protectedResourceMetadata } from "../lib/mcp/oauth.server";

/** স্টোরের MCP ঠিকানার তথ্য (RFC 9728): কোন লগইন সার্ভার, কোন অনুমতি */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") return preflight();
  const mcpId = params.id ?? "";
  const shop = isMcpId(mcpId)
    ? await db.shop.findUnique({ where: { mcpId }, select: { uninstalledAt: true } })
    : null;
  if (!shop || shop.uninstalledAt) return jsonReply({ error: "not_found" }, 404);
  return jsonReply(protectedResourceMetadata(mcpServerUrl(mcpId)), 200, {
    "Cache-Control": "public, max-age=3600",
  });
};
