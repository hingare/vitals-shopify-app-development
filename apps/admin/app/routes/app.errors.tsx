import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { CLIENT_REPORT_MAX } from "../lib/errors";
import { pathLocation, recordError } from "../lib/errors.server";
import { allowRequest } from "../lib/rate-limit.server";
import { readJson } from "../lib/request.server";

/**
 * অ্যাডমিন পাতায় ব্রাউজারে কোড ভাঙার খবর (app/lib/errors.ts-এর reportClientError পাঠায়), অ্যাপের ত্রুটির খাতায়।
 * Shopify-র লগইন লাগে; এক স্টোর থেকে ১০ মিনিটে ২০টার বেশি নয়, আর বড় body পড়া হয় না।
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!allowRequest(`admin-errors:${session.shop}`, 20, 10 * 60_000)) {
    return new Response(null, { status: 429 });
  }
  const body = (await readJson(request, CLIENT_REPORT_MAX)) as Record<string, unknown> | null;
  const text = (value: unknown, max: number) =>
    typeof value === "string" ? value.slice(0, max) : "";
  const message = text(body?.message, 1000);
  if (!message) return new Response(null, { status: 400 });
  const error = new Error(message);
  error.name = text(body?.name, 100) || "Error";
  error.stack = text(body?.stack, 4000);
  const path = text(body?.path, 200);
  await recordError({
    source: "admin",
    location: path.startsWith("/app") ? pathLocation(path) : "/app",
    error,
    shop: session.shop,
  });
  return new Response(null, { status: 204 });
};
