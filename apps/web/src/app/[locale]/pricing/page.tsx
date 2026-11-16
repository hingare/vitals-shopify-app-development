import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CtaBand } from "@/components/CtaBand";
import { Faq } from "@/components/Faq";
import { JsonLd } from "@/components/JsonLd";
import { PlanCards } from "@/components/PlanCards";
import { Link } from "@/i18n/navigation";
import { getCategories } from "@/lib/catalog";
import { lowestMonthly, trialDays, usd } from "@/lib/pricing";
import { breadcrumbSchema, faqSchema, softwareSchema } from "@/lib/schema";
import { localizedUrl, pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/pricing">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricing" });
  const home = await getTranslations({ locale, namespace: "home" });
  return pageMetadata({
    locale,
    path: "/pricing",
    title: t("metaTitle"),
    description: `${t("lead")} ${home("note", { days: trialDays, price: usd(lowestMonthly(), locale) })}`,
  });
}

export default async function PricingPage({ params }: PageProps<"/[locale]/pricing">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pricing");
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  const home = await getTranslations("home");
  const categories = getCategories(locale);

  const faq = [1, 2, 3, 4, 5].map((n) => ({
    q: t(`faq${n}Q`),
    a: t(`faq${n}A`, { days: trialDays }),
  }));

  const mark = (included: boolean) => (
    <>
      <span aria-hidden="true">{included ? "✓" : "–"}</span>
      <span className="sr-only">{included ? t("included") : t("notIncluded")}</span>
    </>
  );

  return (
    <>
      <section className="page-head">
        <div className="container">
          <Breadcrumbs items={[{ name: nav("home"), href: "/" }, { name: nav("pricing") }]} />
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <PlanCards locale={locale} />
          <div className="callout" style={{ marginTop: 24 }}>
            <p>{t("noUsage")}</p>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <h2>{t("tableTitle")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t("tableTool")}</th>
                  <th scope="col">{t("tableCategory")}</th>
                  <th scope="col">{common("plan.starter")}</th>
                  <th scope="col">{common("plan.professional")}</th>
                </tr>
              </thead>
              <tbody>
                {categories.flatMap((category) =>
                  category.tools.map((tool) => (
                    <tr key={tool.id}>
                      <th scope="row" style={{ fontWeight: 500, background: "transparent" }}>
                        <Link href={`/tools/${tool.id}`}>{tool.name}</Link>
                      </th>
                      <td>{category.name}</td>
                      <td>
                        {mark(tool.plan === "starter")}
                      </td>
                      <td>
                        {mark(true)}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>{t("faqTitle")}</h2>
          <Faq items={faq} />
        </div>
      </section>

      <CtaBand />

      <JsonLd
        data={[
          breadcrumbSchema([
            { name: nav("home"), url: localizedUrl(locale, "/") },
            { name: nav("pricing"), url: localizedUrl(locale, "/pricing") },
          ]),
          softwareSchema(home("lead", { count: categories.flatMap((c) => c.tools).length })),
          faqSchema(faq),
        ]}
      />
    </>
  );
}
