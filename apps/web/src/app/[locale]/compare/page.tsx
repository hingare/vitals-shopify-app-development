import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CtaBand } from "@/components/CtaBand";
import { JsonLd } from "@/components/JsonLd";
import { comparisons } from "@/content/compare";
import { Link } from "@/i18n/navigation";
import { factValues } from "@/lib/pricing";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";
import { localizedUrl, pageMetadata } from "@/lib/seo";
import { fillFacts, plainText } from "@/lib/text";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/compare">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "compare" });
  return pageMetadata({
    locale,
    path: "/compare",
    title: t("metaTitle"),
    description: t("lead"),
  });
}

export default async function CompareIndexPage({ params }: PageProps<"/[locale]/compare">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("compare");
  const nav = await getTranslations("nav");
  const facts = factValues(locale);
  const fill = (text: string) => fillFacts(text, facts);
  const items = comparisons.all(locale);

  return (
    <>
      <section className="page-head">
        <div className="container">
          <Breadcrumbs items={[{ name: nav("home"), href: "/" }, { name: t("breadcrumb") }]} />
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead")}</p>
        </div>
      </section>

      <section className="section">
        <div className="container grid grid-2">
          {items.map((item) => (
            <Link key={item.slug} href={`/compare/${item.slug}`} className="card card-link">
              <h2 style={{ fontSize: "1.25rem" }}>{fill(item.title)}</h2>
              <p className="muted" style={{ margin: 0 }}>
                {plainText(fill(item.description))}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <CtaBand />

      <JsonLd
        data={[
          breadcrumbSchema([
            { name: nav("home"), url: localizedUrl(locale, "/") },
            { name: t("breadcrumb"), url: localizedUrl(locale, "/compare") },
          ]),
          itemListSchema(
            items.map((item) => ({
              name: fill(item.title),
              url: localizedUrl(locale, `/compare/${item.slug}`),
            })),
          ),
        ]}
      />
    </>
  );
}
