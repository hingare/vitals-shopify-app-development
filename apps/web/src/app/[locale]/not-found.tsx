import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <section className="section">
      <div className="container">
        <h1>{t("title")}</h1>
        <p className="lead">{t("body")}</p>
        <div className="btn-row">
          <Link className="btn btn-primary" href="/">
            {t("home")}
          </Link>
          <Link className="btn btn-secondary" href="/help">
            {t("help")}
          </Link>
        </div>
      </div>
    </section>
  );
}
