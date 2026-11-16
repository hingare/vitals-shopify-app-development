import type { LoaderFunctionArgs } from "react-router";
import { getObject } from "../lib/object-store.server";
import { mediaResponse, mimeForKey, verifyMediaQuery } from "../lib/ai/media/files.server";

/**
 * AI-র বানানো ছবি ও ভিডিও দেখা আর নামানো। অ্যাডমিনের <img>/<video> session token পাঠাতে পারে না,
 * তাই লগইনের বদলে ঠিকানাটাই সই করা আর সময়সীমা দেওয়া (app/lib/ai/media/files.server.ts)।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const verified = verifyMediaQuery(new URL(request.url).searchParams);
  const mime = verified ? mimeForKey(verified.key) : null;
  if (!verified || !mime) return new Response("Not found", { status: 404 });
  const body = await getObject(verified.key);
  if (!body) return new Response("Not found", { status: 404 });
  return mediaResponse(body, mime, request.headers.get("range"), verified.download);
};
