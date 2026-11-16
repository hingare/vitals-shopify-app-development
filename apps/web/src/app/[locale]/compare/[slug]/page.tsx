import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Blocks } from "@/components/Blocks";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CtaBand } from "@/components/CtaBand";
import { JsonLd } from "@/components/JsonLd";
import { TryCard } from "@/components/TryCard";
import { comparisons } from "@/content/compare";
import { Link } from "@/i18n/navigation";
import { blockFaq } from "@/lib/blocks";
import { factValues } from "@/lib/pricing";
import { articleSchema, breadcrumbSchema, faqSchema } from "@/lib/schema";
import { localizedUrl, pageMetadata } from "@/lib/seo";
import { fillFacts, formatDate, plainText } from "@/lib/text";

export const dynamicParams = false;

export function generateStaticParams() {
  return comparisons.slugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/compare/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  const item = comparisons.get(locale, slug);
  if (!item) return {};
  const facts = factValues(locale);
  return pageMetadata({
    locale,
    path: `/compare/${slug}`,
    title: fillFacts(item.title, facts),
    description: plainText(fillFacts(item.description, facts)),
    available: comparisons.languages(slug),
    type: "article",
    modifiedTime: item.updated,
  });
}

export default async function ComparisonPage({ params }: PageProps<"/[locale]/compare/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const item = comparisons.get(locale, slug);
  if (!item) notFound();

  const t = await getTranslations("compare");
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  const facts = factValues(locale);
  const fill = (text: string) => fillFacts(text, facts);
  const title = fill(item.title);
  const description = plainText(fill(item.description));
  const url = localizedUrl(locale, `/compare/${slug}`);
  const faq = blockFaq(item.body).map((entry) => ({ q: fill(entry.q), a: fill(entry.a) }));
  const others = comparisons.all(locale).filter((other) => other.slug !== slug);

  return (
    <>
      <section className="page-head">
        <div className="container">
          <Breadcrumbs
            items={[
              { name: nav("home"), href: "/" },
              { name: t("breadcrumb"), href: "/compare" },
              { name: title },
            ]}
          />
          <h1>{title}</h1>
          <p className="lead">{description}</p>
          <div className="meta-row muted">
            <span>{common("updated", { date: formatDate(item.updated, locale) })}</span>
          </div>
        </div>
      </section>

      <div className="container layout">
        <article className="prose">
          <Blocks blocks={item.body} fill={fill} />
        </article>

        <aside className="aside">
          <div className="aside-sticky aside">
            <TryCard locale={locale} />
            {others.length > 0 && (
              <div className="card">
                <h2 style={{ fontSize: "1.05rem" }}>{t("more")}</h2>
                <ul className="aside-list">
                  {others.map((other) => (
                    <li key={other.slug}>
                      <Link href={`/compare/${other.slug}`}>{fill(other.title)}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>

      <CtaBand />

      <JsonLd
        data={[
          articleSchema({
            headline: title,
            description,
            url,
            locale,
            datePublished: item.updated,
            dateModified: item.updated,
          }),
          breadcrumbSchema([
            { name: nav("home"), url: localizedUrl(locale, "/") },
            { name: t("breadcrumb"), url: localizedUrl(locale, "/compare") },
            { name: title, url },
          ]),
          ...(faq.length > 0 ? [faqSchema(faq)] : []),
        ]}
      />
    </>
  );
}
