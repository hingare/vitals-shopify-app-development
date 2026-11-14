import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  jsonReply,
  methodNotAllowed,
  preflight,
  readBody,
  requestIp,
} from "../lib/mcp/http.server";
import { registerClient } from "../lib/mcp/oauth.server";

/** AI সহকারী নিজেকে নথিভুক্ত করে (Dynamic Client Registration, RFC 7591) */
export const loader = ({ request }: LoaderFunctionArgs) =>
  request.method === "OPTIONS" ? preflight() : methodNotAllowed("POST, OPTIONS");

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
  const text = await readBody(request, 16_384);
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const reply = await registerClient(body, requestIp(request));
  return jsonReply(reply.body, reply.status, reply.headers);
};
