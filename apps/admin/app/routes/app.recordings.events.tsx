import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { recordingEvents } from "../lib/recordings.server";

/**
 * একটা রেকর্ডিংয়ের সব ঘটনা (রিপ্লের জন্য), gzip করা JSON। শুধু সেই স্টোরের রেকর্ডিং;
 * ব্রাউজার নিজেই খুলে নেয় (Content-Encoding)।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const id = new URL(request.url).searchParams.get("id");
  const body = id ? await recordingEvents(shop.id, id) : null;
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
      "Cache-Control": "private, no-store",
    },
  });
};
