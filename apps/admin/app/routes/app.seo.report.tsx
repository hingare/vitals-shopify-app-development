import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { visibilityReport } from "../lib/ai-visibility.server";
import { embedEditorUrl } from "../lib/tools.server";

/**
 * AI ভিজিবিলিটির যাচাই (স্টোরফ্রন্টের কয়েকটা পাতা আনে, তাই কয়েক সেকেন্ড লাগে)।
 * /app/seo পেজ খোলার পরে আলাদা করে আনে: পেজ তাড়াতাড়ি খোলে, আর SEO কাজের অগ্রগতি দেখার সময়
 * বারবার স্টোরফ্রন্টে যেতে হয় না।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  try {
    const report = await visibilityReport(admin, shop, {
      themeEditorUrl: embedEditorUrl(session.shop),
    });
    return { ok: true as const, report };
  } catch (error) {
    console.error("[ai-visibility]", error);
    return { ok: false as const };
  }
};
