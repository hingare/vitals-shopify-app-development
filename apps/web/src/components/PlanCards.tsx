import { getTranslations } from "next-intl/server";
import { planFacts, trialDays, usd } from "@/lib/pricing";
import { installHref } from "@/lib/site";

/** The two plans with prices and limits read from the same constants the app bills with. */
export async function PlanCards({ locale }: { locale: string }) {
  const t = await getTranslations("pricing");
  const common = await getTranslations("common");
  const plans = planFacts();
  const num = new Intl.NumberFormat(locale);
  return (
    <div className="plans">
      {plans.map((plan) => {
        const pro = plan.id === "professional";
        return (
          <div key={plan.id} className={`card plan${pro ? " plan-featured" : ""}`}>
            <div className="meta-row" style={{ marginTop: 0 }}>
              <h3 style={{ margin: 0 }}>{common(`plan.${plan.id}`)}</h3>
              <span className="badge">{t("trial", { days: trialDays })}</span>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {pro ? t("professionalSummary") : t("starterSummary")}
            </p>
            <div>
              <div className="plan-price">
                {usd(plan.monthly, locale)}
                <span>{common("perMonth")}</span>
              </div>
              <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.9rem" }}>
                {t("annual", {
                  price: usd(plan.annual, locale),
                  saving: usd(plan.annualSaving, locale),
                })}
              </p>
            </div>
            <ul className="check-list">
              {pro && <li>{t("includesEverything")}</li>}
              <li>{t("includesTools", { count: plan.tools })}</li>
              {plan.aiCredits > 0 && (
                <li>
                  {t("includesAi", {
                    credits: num.format(plan.aiCredits),
                    trial: num.format(plan.aiTrialCredits),
                  })}
                </li>
              )}
              {plan.emails > 0 && <li>{t("includesEmails", { count: num.format(plan.emails) })}</li>}
              {plan.recordings > 0 && (
                <li>{t("includesRecordings", { count: num.format(plan.recordings) })}</li>
              )}
            </ul>
            <a className={`btn ${pro ? "btn-primary" : "btn-secondary"}`} href={installHref()}>
              {t("choose")}
            </a>
          </div>
        );
      })}
    </div>
  );
}
