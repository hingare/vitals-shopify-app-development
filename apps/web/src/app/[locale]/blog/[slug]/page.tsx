import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Blocks } from "@/components/Blocks";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CtaBand } from "@/components/CtaBand";
import { JsonLd } from "@/components/JsonLd";
import { TryCard } from "@/components/TryCard";
import { latestPosts, posts } from "@/content/blog";
import { Link } from "@/i18n/navigation";
import { blockFaq, blockTexts } from "@/lib/blocks";
import { factValues } from "@/lib/pricing";
import { articleSchema, breadcrumbSchema, faqSchema } from "@/lib/schema";
import { localizedUrl, pageMetadata } from "@/lib/seo";
import { fillFacts, formatDate, plainText, readingMinutes } from "@/lib/text";

export const dynamicParams = false;

export function generateStaticParams() {
  return posts.slugs().map((slug) => ({ slug }));
}

/** How many other posts to suggest beside an article */
const MORE_POSTS = 4;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/blog/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = posts.get(locale, slug);
  if (!post) return {};
  const facts = factValues(locale);
  return pageMetadata({
    locale,
    path: `/blog/${slug}`,
    title: fillFacts(post.title, facts),
    description: plainText(fillFacts(post.description, facts)),
    available: posts.languages(slug),
    type: "article",
    publishedTime: post.published,
    modifiedTime: post.updated,
  });
}

export default async function BlogPostPage({ params }: PageProps<"/[locale]/blog/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const post = posts.get(locale, slug);
  if (!post) notFound();

  const t = await getTranslations("blog");
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  const facts = factValues(locale);
  const fill = (text: string) => fillFacts(text, facts);
  const title = fill(post.title);
  const description = plainText(fill(post.description));
  const url = localizedUrl(locale, `/blog/${slug}`);
  const minutes = readingMinutes(blockTexts(post.body).map(fill));
  const faq = blockFaq(post.body).map((entry) => ({ q: fill(entry.q), a: fill(entry.a) }));
  const more = latestPosts(locale)
    .filter((other) => other.slug !== slug)
    .slice(0, MORE_POSTS);

  return (
    <>
      <section className="page-head">
        <div className="container">
          <Breadcrumbs
            items={[
              { name: nav("home"), href: "/" },
              { name: t("breadcrumb"), href: "/blog" },
              { name: title },
            ]}
          />
          <h1>{title}</h1>
          <p className="lead">{description}</p>
          <div className="meta-row muted">
            <span>{t("published", { date: formatDate(post.published, locale) })}</span>
            {post.updated !== post.published && (
              <span>{common("updated", { date: formatDate(post.updated, locale) })}</span>
            )}
            <span>{t("minutes", { count: minutes })}</span>
          </div>
        </div>
      </section>

      <div className="container layout">
        <article className="prose">
          <Blocks blocks={post.body} fill={fill} />
        </article>

        <aside className="aside">
          <div className="aside-sticky aside">
            <TryCard locale={locale} />
            {more.length > 0 && (
              <div className="card">
                <h2 style={{ fontSize: "1.05rem" }}>{t("more")}</h2>
                <ul className="aside-list">
                  {more.map((other) => (
                    <li key={other.slug}>
                      <Link href={`/blog/${other.slug}`}>{fill(other.title)}</Link>
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
            type: "BlogPosting",
            headline: title,
            description,
            url,
            locale,
            datePublished: post.published,
            dateModified: post.updated,
          }),
          breadcrumbSchema([
            { name: nav("home"), url: localizedUrl(locale, "/") },
            { name: t("breadcrumb"), url: localizedUrl(locale, "/blog") },
            { name: title, url },
          ]),
          ...(faq.length > 0 ? [faqSchema(faq)] : []),
        ]}
      />
    </>
  );
}
