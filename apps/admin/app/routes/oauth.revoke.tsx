import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { jsonReply, methodNotAllowed, preflight, readForm } from "../lib/mcp/http.server";
import { revokeRequest } from "../lib/mcp/oauth.server";

/** AI সহকারী নিজে সংযোগ বন্ধ করলে (RFC 7009) */
export const loader = ({ request }: LoaderFunctionArgs) =>
  request.method === "OPTIONS" ? preflight() : methodNotAllowed("POST, OPTIONS");

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
  const form = await readForm(request);
  if (!form) {
    return jsonReply({ error: "invalid_request", error_description: "Unreadable request" }, 400);
  }
  const reply = await revokeRequest(form, request.headers.get("authorization"));
  return jsonReply(reply.body, reply.status, reply.headers);
};
