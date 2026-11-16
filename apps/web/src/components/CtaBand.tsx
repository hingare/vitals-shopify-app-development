import { getTranslations } from "next-intl/server";
import { InstallButton } from "./InstallButton";
import { trialDays } from "@/lib/pricing";

export async function CtaBand() {
  const t = await getTranslations("home");
  return (
    <section className="section">
      <div className="container">
        <div className="cta-band">
          <h2>{t("finalTitle", { days: trialDays })}</h2>
          <p>{t("finalBody")}</p>
          <div className="btn-row">
            <InstallButton />
          </div>
        </div>
      </div>
    </section>
  );
}
