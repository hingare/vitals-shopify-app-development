import type { LoaderFunctionArgs } from "react-router";
import { appUrl } from "../lib/links.server";
import { jsonReply, preflight } from "../lib/mcp/http.server";
import { protectedResourceMetadata } from "../lib/mcp/oauth.server";

/**
 * সাধারণ ঠিকানার (RFC 9728) তথ্য। স্টোরের নিজের ঠিকানার তথ্য .../mcp/<id>-এ;
 * সহকারী সাধারণত 401-এর হেডার থেকে সেটাই পায়, এটা শুধু পুরনো ক্লায়েন্টের জন্য।
 */
export const loader = ({ request }: LoaderFunctionArgs) =>
  request.method === "OPTIONS"
    ? preflight()
    : jsonReply(protectedResourceMetadata(appUrl()), 200, {
        "Cache-Control": "public, max-age=3600",
      });
