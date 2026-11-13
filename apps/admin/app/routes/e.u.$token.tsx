import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { escapeHtml } from "../lib/email-template";
import { readUnsubscribeToken } from "../lib/links.server";
import { shopDisplayName } from "../lib/messages.server";
import { unsubscribe } from "../lib/subscribers.server";

/**
 * ইমেইলের আনসাবস্ক্রাইব লিংক।
 * GET: নিশ্চিত করার পেজ (ইমেইল স্ক্যানার লিংক খুললেই যেন আনসাবস্ক্রাইব না হয়ে যায়)।
 * POST: আনসাবস্ক্রাইব। Gmail/Yahoo-র "এক ক্লিকে আনসাবস্ক্রাইব" (RFC 8058) সরাসরি এখানে POST করে।
 * টোকেন সই করা, তাই কেউ অন্যের ঠিকানা বন্ধ করাতে পারে না।
 */
function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f3f4f6;color:#111827}
main{max-width:440px;margin:12vh auto;padding:32px 24px;background:#fff;border-radius:12px;text-align:center}
h1{font-size:22px;margin:0 0 12px}p{font-size:16px;line-height:24px;color:#374151;margin:0 0 20px}
button{font-size:16px;min-height:44px;padding:12px 24px;border:0;border-radius:8px;background:#111827;color:#fff;cursor:pointer}
button:focus-visible{outline:3px solid #2563eb;outline-offset:2px}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const invalid = () =>
  page(
    "This link is not valid",
    "<p>Please use the unsubscribe link from a recent email.</p>",
    404,
  );

async function shopName(shopId: string) {
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: { domain: true, emailSettings: true },
  });
  return shop ? shopDisplayName(shop) : null;
}

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const token = readUnsubscribeToken(params.token ?? "");
  const name = token ? await shopName(token.shopId) : null;
  if (!token || !name) return invalid();
  return page(
    "Unsubscribe",
    `<p>Stop marketing emails from ${escapeHtml(name)} to <strong>${escapeHtml(token.email)}</strong>?</p>
<form method="post"><button type="submit">Unsubscribe</button></form>`,
  );
};

export const action = async ({ params }: ActionFunctionArgs) => {
  const token = readUnsubscribeToken(params.token ?? "");
  const name = token ? await shopName(token.shopId) : null;
  if (!token || !name) return invalid();
  await unsubscribe(token.shopId, token.email);
  return page(
    "You are unsubscribed",
    `<p>${escapeHtml(token.email)} will no longer get marketing emails from ${escapeHtml(name)}.</p>`,
  );
};
