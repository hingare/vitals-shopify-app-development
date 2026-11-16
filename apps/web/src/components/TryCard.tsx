import { getTranslations } from "next-intl/server";
import { lowestMonthly, trialDays, usd } from "@/lib/pricing";
import { InstallButton } from "./InstallButton";

/** A small "try it free" card for the side column of comparisons and blog posts */
export async function TryCard({ locale }: { locale: string }) {
  const t = await getTranslations("home");
  return (
    <div className="card">
      <h2 style={{ fontSize: "1.05rem" }}>{t("finalTitle", { days: trialDays })}</h2>
      <p className="muted">{t("note", { days: trialDays, price: usd(lowestMonthly(), locale) })}</p>
      <InstallButton />
    </div>
  );
}
