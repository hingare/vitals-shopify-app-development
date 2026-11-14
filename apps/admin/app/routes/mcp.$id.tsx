import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { handleMcpRequest } from "../lib/mcp/server.server";

/**
 * স্টোরের AI সহকারীর ঠিকানা (MCP, Streamable HTTP): ChatGPT, Claude, Gemini, Grok এখানে কথা বলে।
 * React Router GET/HEAD/OPTIONS loader-এ আর POST/DELETE action-এ পাঠায়; সব একই জায়গায় যায়।
 */
export const loader = ({ request, params }: LoaderFunctionArgs) =>
  handleMcpRequest(request, params.id ?? "");

export const action = ({ request, params }: ActionFunctionArgs) =>
  handleMcpRequest(request, params.id ?? "");
