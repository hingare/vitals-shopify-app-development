import type { Metadata } from "next";
import { brand } from "@app/brand";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Blocks } from "@/components/Blocks";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Faq } from "@/components/Faq";
import { JsonLd } from "@/components/JsonLd";
import { PlanBadge } from "@/components/PlanBadge";
import { Inline } from "@/components/RichText";
import { SettingsTable } from "@/components/SettingsTable";
import {
  getGuide,
  getToolArticle,
  guideSlugs,
  helpLanguages,
  type Guide,
  type ToolArticle,
} from "@/content/help";
import { Link } from "@/i18n/navigation";
import { getSettings, getTool, toolIds, type CatalogTool } from "@/lib/catalog";
import { factValues } from "@/lib/pricing";
import { articleSchema, breadcrumbSchema, faqSchema } from "@/lib/schema";
import { localizedUrl, pageMetadata } from "@/lib/seo";
import { CONTENT_UPDATED, supportChatEnabled } from "@/lib/site";
import { clip, fillFacts, plainText } from "@/lib/text";

export const dynamicParams = false;

export function generateStaticParams() {
  return [...toolIds(), ...guideSlugs()].map((slug) => ({ slug }));
}

/** Tools that show something in the store need the app embed switched on first */
const NEEDS_EMBED = new Set(["embed", "block", "function"]);

type Page =
  | { kind: "tool"; tool: CatalogTool; article: ToolArticle | null }
  | { kind: "guide"; guide: Guide };

function findPage(locale: string, slug: string): Page | null {
  const tool = getTool(locale, slug);
  if (tool) return { kind: "tool", tool, article: getToolArticle(locale, slug) };
  const guide = getGuide(locale, slug);
  return guide ? { kind: "guide", guide } : null;
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/help/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  const page = findPage(locale, slug);
  if (!page) return {};
  const t = await getTranslations({ locale, namespace: "help" });
  const facts = factValues(locale);
  const common = {
    locale,
    path: `/help/${slug}`,
    available: helpLanguages(slug),
    type: "article" as const,
    modifiedTime: CONTENT_UPDATED,
  };
  if (page.kind === "guide") {
    return pageMetadata({
      ...common,
      title: page.guide.title,
      description: plainText(fillFacts(page.guide.description, facts)),
    });
  }
  return pageMetadata({
    ...common,
    title: t("articleTitle", { name: page.tool.name }),
    description: clip(plainText(fillFacts(page.article?.intro ?? page.tool.description, facts))),
  });
}

export default async function HelpArticlePage({ params }: PageProps<"/[locale]/help/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const page = findPage(locale, slug);
  if (!page) notFound();

  const t = await getTranslations("help");
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  const facts = factValues(locale);
  const fill = (text: string) => fillFacts(text, facts);

  const title = page.kind === "tool" ? t("articleTitle", { name: page.tool.name }) : page.guide.title;
  const description =
    page.kind === "tool"
      ? page.tool.description
      : plainText(fill(page.guide.description));
  const url = localizedUrl(locale, `/help/${slug}`);
  const faq =
    page.kind === "tool"
      ? (page.article?.faq ?? [])
      : page.guide.body.flatMap((block) => (block.type === "faq" ? block.items : []));
  const related = (page.kind === "tool" ? page.article?.related : page.guide.related) ?? [];

  return (
    <>
      <section className="page-head">
        <div className="container">
          <Breadcrumbs
            items={[
              { name: nav("home"), href: "/" },
              { name: t("breadcrumb"), href: "/help" },
              { name: title },
            ]}
          />
          <h1>{title}</h1>
          <p className="lead">{description}</p>
          <div className="meta-row muted">
            {page.kind === "tool" && <PlanBadge plan={page.tool.plan} />}
            <span>{common("updated", { date: formatDate(CONTENT_UPDATED, locale) })}</span>
          </div>
        </div>
      </section>

      <div className="container layout">
        <article className="prose">
          {page.kind === "tool" ? (
            <ToolArticleBody
              locale={locale}
              tool={page.tool}
              article={page.article}
              fill={fill}
            />
          ) : (
            <Blocks blocks={page.guide.body} fill={fill} />
          )}

          <h2>{t("stuck")}</h2>
          <p>
            <Inline
              text={t(supportChatEnabled() ? "stuckBody" : "stuckBodyNoChat", {
                email: `[${brand.supportEmail}](mailto:${brand.supportEmail})`,
              })}
            />
          </p>
        </article>

        <aside className="aside">
          <div className="aside-sticky aside">
            {page.kind === "tool" && (
              <div className="card">
                <h2 style={{ fontSize: "1.05rem" }}>{t("toolPage")}</h2>
                <p className="muted">{page.tool.description}</p>
                <Link href={`/tools/${page.tool.id}`}>{common("learnMore")}</Link>
              </div>
            )}
            {related.length > 0 && (
              <div className="card">
                <h2 style={{ fontSize: "1.05rem" }}>{t("related")}</h2>
                <ul className="aside-list">
                  {related.map((ref) => (
                    <li key={ref}>
                      <Link href={`/help/${ref}`}>
                        {relatedTitle(locale, ref, (name) => t("articleTitle", { name }))}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>

      <JsonLd
        data={[
          articleSchema({
            type: "TechArticle",
            headline: title,
            description,
            url,
            locale,
            datePublished: CONTENT_UPDATED,
            dateModified: CONTENT_UPDATED,
          }),
          breadcrumbSchema([
            { name: nav("home"), url: localizedUrl(locale, "/") },
            { name: t("breadcrumb"), url: localizedUrl(locale, "/help") },
            { name: title, url },
          ]),
          ...(faq.length > 0
            ? [faqSchema(faq.map((item) => ({ q: fill(item.q), a: fill(item.a) })))]
            : []),
        ]}
      />
    </>
  );
}

function formatDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function relatedTitle(locale: string, ref: string, toolTitle: (name: string) => string): string {
  const tool = getTool(locale, ref);
  if (tool) return toolTitle(tool.name);
  return getGuide(locale, ref)?.title ?? ref;
}

async function ToolArticleBody({
  locale,
  tool,
  article,
  fill,
}: {
  locale: string;
  tool: CatalogTool;
  article: ToolArticle | null;
  fill: (text: string) => string;
}) {
  const t = await getTranslations("help");
  const common = await getTranslations("common");
  const surface = await getTranslations("surface");
  const delivery = await getTranslations("delivery");
  const settings = tool.alwaysOn
    ? []
    : getSettings(locale, tool.id, {
        on: common("on"),
        off: common("off"),
        empty: common("empty"),
        none: common("none"),
      });

  const steps = tool.alwaysOn
    ? [t("stepOpenStudio", { name: tool.name }), ...(article?.setup ?? [])]
    : [
        t("stepOpen", { name: tool.name }),
        ...(article?.setup ?? []),
        t("stepSave"),
      ];

  return (
    <>
      <h2>{t("summary")}</h2>
      <p>
        <Inline text={fill(article?.intro ?? tool.description)} />
      </p>
      <ul>
        <li>
          <strong>{t("plan")}:</strong> {common(`planBadge.${tool.plan}`)}
        </li>
        <li>
          <strong>{t("where")}:</strong>{" "}
          {tool.surfaces.map((s) => surface(s)).join(", ")}
        </li>
      </ul>
      <p className="muted">{delivery(tool.alwaysOn ? "adminAlwaysOn" : tool.delivery)}</p>
      {tool.plan === "professional" && (
        <div className="callout">
          <p>
            <Inline text={t("proNote")} />
          </p>
        </div>
      )}

      <h2>{t("steps")}</h2>
      {NEEDS_EMBED.has(tool.delivery) && (
        <div className="callout">
          <p>
            <Inline text={t("embedFirst")} />
          </p>
        </div>
      )}
      <ol className="steps">
        {steps.map((step, index) => (
          <li key={index}>
            <Inline text={fill(step)} />
          </li>
        ))}
      </ol>
      {article?.after && article.after.length > 0 && (
        <>
          <h3>{t("next")}</h3>
          <ul>
            {article.after.map((item, index) => (
              <li key={index}>
                <Inline text={fill(item)} />
              </li>
            ))}
          </ul>
        </>
      )}

      {settings.length > 0 && (
        <>
          <h2 id="settings">{t("settings")}</h2>
          <p>{t("settingsLead", { name: tool.name })}</p>
          <SettingsTable rows={settings} />
        </>
      )}

      {article?.tips && article.tips.length > 0 && (
        <>
          <h2>{t("tips")}</h2>
          <ul>
            {article.tips.map((tip, index) => (
              <li key={index}>
                <Inline text={fill(tip)} />
              </li>
            ))}
          </ul>
        </>
      )}

      {article?.faq && article.faq.length > 0 && (
        <>
          <h2>{t("faq")}</h2>
          <Faq items={article.faq.map((item) => ({ q: fill(item.q), a: fill(item.a) }))} />
        </>
      )}

      <h2>{t("off")}</h2>
      <p>{tool.alwaysOn ? t("offBodyAlwaysOn") : t("offBody")}</p>
    </>
  );
}
