import { emailMarketing } from "@app/tools";
import { canUseTool, type AnyTool } from "@app/tool-sdk";
import db from "../db.server";
import { readEmailSettings } from "./email-template";
import { emailProvider } from "./email-transport.server";
import { emailsSentThisMonth, shopDisplayName } from "./messages.server";
import { EMAIL_MONTHLY_CAP } from "./plans";
import { planOf } from "./shop.server";
import { allowRequest } from "./rate-limit.server";

/** Marketing পেজগুলোর সবার দরকারি তথ্য এক জায়গায় */
export async function marketingContext(shop: {
  id: string;
  domain: string;
  plan: string | null;
  emailSettings: unknown;
}) {
  const plan = planOf(shop);
  const [tool, sent] = await Promise.all([
    db.toolSetting.findUnique({
      where: { shopId_toolId: { shopId: shop.id, toolId: emailMarketing.id } },
      select: { enabled: true },
    }),
    emailsSentThisMonth(shop.id),
  ]);
  const settings = readEmailSettings(shop.emailSettings);
  return {
    allowed: plan !== null && canUseTool(emailMarketing as unknown as AnyTool, plan),
    toolEnabled: tool?.enabled ?? false,
    configured: emailProvider() !== "none",
    sent,
    cap: plan ? EMAIL_MONTHLY_CAP[plan] : 0,
    settings,
    look: {
      shopName: shopDisplayName(shop),
      accent: settings.accent,
      postalAddress: settings.postalAddress,
    },
    storeUrl: `https://${shop.domain}`,
  };
}

/** পরীক্ষার ইমেইল: স্টোর প্রতি ১০ মিনিটে ৫টা (ভুল করে বা ইচ্ছা করে বারবার পাঠানো ঠেকাতে) */
export const allowTestSend = (shopId: string) =>
  allowRequest(`test-email:${shopId}`, 5, 10 * 60_000);
