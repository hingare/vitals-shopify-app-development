import { translate } from "@app/i18n";

/**
 * AI সহকারীর চাওয়া পরিবর্তন এক লাইনে (assistants.do.* লেখা)। সার্ভার আর অ্যাপের পাতা দুই জায়গাতেই লাগে:
 * সহকারীকে ইংরেজিতে, অ্যাপে মার্চেন্টের ভাষায়।
 */
export const ACTION_STATUSES = [
  "pending",
  "running",
  "done",
  "failed",
  "rejected",
  "expired",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function describeAction(
  tool: string,
  input: unknown,
  details: unknown,
  t: Translate = (key, vars) => translate("en", key, vars),
): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const info = (details ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  if (tool === "request_feature_change") {
    const name = t(`tool.${text(args.featureId)}.name`);
    return t(args.enabled ? "assistants.do.featureOn" : "assistants.do.featureOff", { name });
  }
  if (tool === "request_offer_change") {
    const name = text(info.name) || text(args.offerId);
    return t(args.active ? "assistants.do.offerOn" : "assistants.do.offerOff", { name });
  }
  if (tool === "request_review_change") {
    const vars = { rating: Number(info.rating) || 0, author: text(info.author) || "?" };
    if (args.action === "reply") {
      return t("assistants.do.reviewReply", { ...vars, reply: text(args.reply) });
    }
    return t(
      args.action === "publish" ? "assistants.do.reviewPublish" : "assistants.do.reviewReject",
      vars,
    );
  }
  return tool;
}
