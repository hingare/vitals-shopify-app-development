import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CtaBand } from "@/components/CtaBand";
import { JsonLd } from "@/components/JsonLd";
import { ToolCard } from "@/components/ToolCard";
import { getCategories, planCounts, toolIds } from "@/lib/catalog";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";
import { localizedUrl, pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]/tools">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });
  const counts = planCounts();
  return pageMetadata({
    locale,
    path: "/tools",
    title: t("metaTitle"),
    description: t("lead", { starter: counts.starter }),
  });
}

export default async function ToolsPage({ params }: PageProps<"/[locale]/tools">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("tools");
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  const categories = getCategories(locale);
  const counts = planCounts();

  return (
    <>
      <section className="page-head">
        <div className="container">
          <Breadcrumbs items={[{ name: nav("home"), href: "/" }, { name: nav("tools") }]} />
          <h1>{t("title", { count: toolIds().length })}</h1>
          <p className="lead">{t("lead", { starter: counts.starter })}</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <nav aria-label={t("jump")}>
            <ul className="category-nav">
              {categories.map((category) => (
                <li key={category.id}>
                  <a href={`#${category.id}`}>{category.name}</a>
                </li>
              ))}
            </ul>
          </nav>

          {categories.map((category) => (
            <section key={category.id} id={category.id} className="category-block">
              <h2>
                {category.name}{" "}
                <small>{common("toolCount", { count: category.tools.length })}</small>
              </h2>
              <div className="grid grid-3">
                {category.tools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <CtaBand />

      <JsonLd
        data={[
          breadcrumbSchema([
            { name: nav("home"), url: localizedUrl(locale, "/") },
            { name: nav("tools"), url: localizedUrl(locale, "/tools") },
          ]),
          itemListSchema(
            categories.flatMap((category) =>
              category.tools.map((tool) => ({
                name: tool.name,
                url: localizedUrl(locale, `/tools/${tool.id}`),
              })),
            ),
          ),
        ]}
      />
    </>
  );
}
