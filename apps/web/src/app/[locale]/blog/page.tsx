import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CtaBand } from "@/components/CtaBand";
import { JsonLd } from "@/components/JsonLd";
import { latestPosts } from "@/content/blog";
import { Link } from "@/i18n/navigation";
import { blockTexts } from "@/lib/blocks";
import { factValues } from "@/lib/pricing";
import { breadcrumbSchema, itemListSchema } from "@/lib/schema";
import { localizedUrl, pageMetadata } from "@/lib/seo";
import { fillFacts, formatDate, plainText, readingMinutes } from "@/lib/text";

export async function generateMetadata({ params }: PageProps<"/[locale]/blog">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "blog" });
  return pageMetadata({ locale, path: "/blog", title: t("metaTitle"), description: t("lead") });
}

export default async function BlogIndexPage({ params }: PageProps<"/[locale]/blog">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("blog");
  const nav = await getTranslations("nav");
  const facts = factValues(locale);
  const fill = (text: string) => fillFacts(text, facts);
  const posts = latestPosts(locale);

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
        <div className="container grid grid-3">
          {posts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="card card-link">
              <h2 style={{ fontSize: "1.15rem" }}>{fill(post.title)}</h2>
              <p className="muted">{plainText(fill(post.description))}</p>
              <p className="muted" style={{ margin: 0, fontSize: "0.875rem" }}>
                <time dateTime={post.published}>{formatDate(post.published, locale)}</time>
                {" · "}
                {t("minutes", { count: readingMinutes(blockTexts(post.body).map(fill)) })}
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
            { name: t("breadcrumb"), url: localizedUrl(locale, "/blog") },
          ]),
          itemListSchema(
            posts.map((post) => ({
              name: fill(post.title),
              url: localizedUrl(locale, `/blog/${post.slug}`),
            })),
          ),
        ]}
      />
    </>
  );
}
