import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { askAssistant, parseAsk } from "../lib/support-ai.server";
import type { AskResult } from "../lib/support";

/** Help পাতার সাপোর্ট সহকারী: কথোপকথন পাঠালে উত্তর (JSON, AskResult) */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const parsed = parseAsk(await request.json().catch(() => null));
  const result: AskResult = parsed.ok
    ? await askAssistant(shop, parsed.messages)
    : { ok: false, error: parsed.error };
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
};
