import { useT } from "../../lib/i18n";

export interface Credits {
  used: number;
  limit: number;
  left: number;
  trial: boolean;
  resetsAt: string;
}

/** এই মাসের AI ক্রেডিট: কত খরচ হলো, কত বাকি, কবে আবার ভরবে */
export function CreditsSummary({ credits }: { credits: Credits }) {
  const t = useT();
  const resets = new Date(credits.resetsAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
  });
  const share = credits.limit > 0 ? credits.used / credits.limit : 1;
  return (
    <s-section heading={t("ai.credits.title")}>
      <s-stack direction="block" gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-heading>
            {t("ai.credits.used", { used: credits.used, limit: credits.limit })}
          </s-heading>
          {credits.limit > 0 && share >= 1 && <s-badge tone="critical">{t("ai.credits.out")}</s-badge>}
          {credits.limit > 0 && share >= 0.8 && share < 1 && (
            <s-badge tone="warning">{t("ai.credits.low")}</s-badge>
          )}
        </s-stack>
        <s-text color="subdued">{t("ai.credits.refill", { date: resets })}</s-text>
        {credits.trial && <s-text color="subdued">{t("ai.credits.trial")}</s-text>}
        <s-text color="subdued">{t("ai.credits.help")}</s-text>
      </s-stack>
    </s-section>
  );
}
