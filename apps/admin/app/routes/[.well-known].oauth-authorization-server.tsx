import type { LoaderFunctionArgs } from "react-router";
import { jsonReply, preflight } from "../lib/mcp/http.server";
import { authorizationServerMetadata } from "../lib/mcp/oauth.server";

/** AI সহকারীর লগইনের ঠিকানাগুলো (RFC 8414); app/lib/mcp/oauth.server.ts */
export const loader = ({ request }: LoaderFunctionArgs) =>
  request.method === "OPTIONS"
    ? preflight()
    : jsonReply(authorizationServerMetadata(), 200, { "Cache-Control": "public, max-age=3600" });
