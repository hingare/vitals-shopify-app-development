import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { euWithdrawal } from "@app/tools";
import { authenticate } from "../shopify.server";
import { allowRequest } from "../lib/rate-limit.server";
import {
  activeShop,
  clientIp,
  enabledSettings,
  jsonResponse,
  readJson,
} from "../lib/tool-state.server";
import { submitWithdrawal } from "../lib/withdrawals.server";

/**
 * EU Withdrawal Button (App Proxy: /apps/app-tools/withdraw)।
 * GET: স্টোরের থিমের ভেতরে একটা পেজ, যেখানে উইজেট ফর্মটা বসায়। লগইন করা ক্রেতার নাম আর ইমেইল
 *      Liquid দিয়ে আগে থেকে বসে, যাতে তাঁকে শুধু মিলিয়ে দেখতে হয়।
 * POST: বিবৃতি জমা নেয় আর প্রাপ্তিস্বীকারের ইমেইল লাইনে দেয়।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const shop = await activeShop(session?.shop);
  // টুল বন্ধ থাকলে ফাঁকা পেজ নয়: পুরোনো লিংকে এলে ক্রেতা স্পষ্ট "নেই" দেখে
  if (!shop || !(await enabledSettings(shop, euWithdrawal))) {
    return new Response("Not found", { status: 404 });
  }
  // application/liquid দিলে Shopify এটা স্টোরের থিমের layout-এর ভেতরে দেখায় আর Liquid চালায়
  return new Response(
    '<div id="app-eu-withdrawal-page" style="min-height:40vh"' +
      ' data-name="{{ customer.name | escape }}" data-email="{{ customer.email | escape }}"></div>',
    // পেজে ক্রেতার নিজের নাম আর ইমেইল থাকে, তাই কোথাও জমা (cache) রাখা যাবে না
    { headers: { "Content-Type": "application/liquid", "Cache-Control": "no-store" } },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const shop = await activeShop(session?.shop);
  if (!shop) return jsonResponse({ error: "disabled" }, 404);
  // এক ব্রাউজার থেকে বারবার জমা ঠেকাতে; ঠিকানা আর স্টোর ধরে আলাদা সীমা submitWithdrawal-এ
  if (!allowRequest(`withdraw:${shop.id}:${clientIp(request)}`, 5, 10 * 60_000)) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }
  const body = (await readJson(request)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonResponse({ error: "invalid" }, 400);
  const result = await submitWithdrawal(shop, {
    name: body.name,
    email: body.email,
    order: body.order,
    details: body.details,
    locale: body.locale,
  });
  if (!result.ok) {
    if (result.error === "disabled") return jsonResponse({ error: "disabled" }, 404);
    if (result.error === "too_many") return jsonResponse({ error: "rate_limited" }, 429);
    return jsonResponse({ error: "invalid" }, 400);
  }
  // পেজেও হুবহু সেই তারিখ ও সময় দেখানো হয় যা ইমেইলে যায়
  return jsonResponse({
    ok: true,
    submittedAt: result.submittedAt.toISOString(),
    submitted: result.submitted,
  });
};
