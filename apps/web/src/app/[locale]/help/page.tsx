import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { HelpSearch, type SearchItem } from "@/components/HelpSearch";
import { JsonLd } from "@/components/JsonLd";
import { getGuides } from "@/content/help";
import { Link } from "@/i18n/navigation";
import { getCategories, toolIds } from "@/lib/catalog";
import { factValues } from "@/lib/pricing";
import { breadcrumbSchema } from "@/lib/schema";
import { localizedUrl, pageMetadata } from "@/lib/seo";
import { supportChatEnabled } from "@/lib/site";
import { fillFacts, plainText } from "@/lib/text";

export async function generateMetadata({ params }: PageProps<"/[locale]/help">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "help" });
  return pageMetadata({
    locale,
    path: "/help",
    title: t("metaTitle"),
    description: t("lead", { count: toolIds().length }),
  });
}

export default async function HelpPage({ params }: PageProps<"/[locale]/help">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("help");
  const nav = await getTranslations("nav");
  const facts = factValues(locale);
  const guides = getGuides(locale);
  const categories = getCategories(locale);

  const searchItems: SearchItem[] = [
    ...guides.map((guide) => ({
      title: guide.title,
      description: plainText(fillFacts(guide.description, facts)),
      href: `/help/${guide.slug}`,
      keywords: "",
    })),
    ...categories.flatMap((category) =>
      category.tools.map((tool) => ({
        title: t("articleTitle", { name: tool.name }),
        description: tool.description,
        href: `/help/${tool.id}`,
        keywords: category.name,
      })),
    ),
  ];

  return (
    <>
      <section className="page-head">
        <div className="container">
          <Breadcrumbs items={[{ name: nav("home"), href: "/" }, { name: t("breadcrumb") }]} />
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead", { count: toolIds().length })}</p>
          <HelpSearch
            items={searchItems}
            label={t("search")}
            empty={t(supportChatEnabled() ? "searchEmpty" : "searchEmptyNoChat")}
          />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>{t("guides")}</h2>
          <div className="grid grid-3">
            {guides.map((guide) => (
              <Link key={guide.slug} href={`/help/${guide.slug}`} className="card card-link">
                <h3>{guide.title}</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {plainText(fillFacts(guide.description, facts))}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <h2>{t("toolGuides")}</h2>
          <div className="grid grid-3">
            {categories.map((category) => (
              <div key={category.id}>
                <h3>{category.name}</h3>
                <ul className="link-list">
                  {category.tools.map((tool) => (
                    <li key={tool.id}>
                      <Link href={`/help/${tool.id}`}>{tool.name}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <JsonLd
        data={breadcrumbSchema([
          { name: nav("home"), url: localizedUrl(locale, "/") },
          { name: t("breadcrumb"), url: localizedUrl(locale, "/help") },
        ])}
      />
    </>
  );
}
