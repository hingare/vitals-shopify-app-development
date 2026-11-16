import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CtaBand } from "@/components/CtaBand";
import { Faq } from "@/components/Faq";
import { InstallButton } from "@/components/InstallButton";
import { JsonLd } from "@/components/JsonLd";
import { PlanBadge } from "@/components/PlanBadge";
import { Inline } from "@/components/RichText";
import { getToolArticle } from "@/content/help";
import { Link } from "@/i18n/navigation";
import { categoryName, getCatalog, getSettings, getTool, toolIds } from "@/lib/catalog";
import { factValues, planFacts, trialDays, usd } from "@/lib/pricing";
import { breadcrumbSchema, faqSchema } from "@/lib/schema";
import { localizedUrl, pageMetadata } from "@/lib/seo";
import { clip, fillFacts, plainText } from "@/lib/text";

export const dynamicParams = false;

export function generateStaticParams() {
  return toolIds().map((slug) => ({ slug }));
}

/** How many setting names to list before linking to the full table in the guide */
const SETTINGS_SHOWN = 8;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/tools/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  const tool = getTool(locale, slug);
  if (!tool) return {};
  const t = await getTranslations({ locale, namespace: "tool" });
  const article = getToolArticle(locale, slug);
  return pageMetadata({
    locale,
    path: `/tools/${slug}`,
    title: t("metaTitle", { name: tool.name, category: categoryName(locale, tool.category) }),
    description: clip(plainText(fillFacts(article?.intro ?? tool.description, factValues(locale)))),
  });
}

export default async function ToolPage({ params }: PageProps<"/[locale]/tools/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const tool = getTool(locale, slug);
  if (!tool) notFound();

  const t = await getTranslations("tool");
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  const surface = await getTranslations("surface");
  const delivery = await getTranslations("delivery");
  const facts = factValues(locale);
  const fill = (text: string) => fillFacts(text, facts);
  const article = getToolArticle(locale, slug);
  const category = categoryName(locale, tool.category);
  const catalog = getCatalog(locale);
  const plan = planFacts().find((p) => p.id === tool.plan)!;

  const settings = tool.alwaysOn
    ? []
    : getSettings(locale, tool.id, {
        on: common("on"),
        off: common("off"),
        empty: common("empty"),
        none: common("none"),
      });
  const conflicts = tool.conflictsWith
    .map((id) => catalog.find((other) => other.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const notes = [
    ...(tool.nativeAlternative ? [t("native", { feature: tool.nativeAlternative })] : []),
    ...(tool.offByDefault ? [t("offByDefault")] : []),
    ...(conflicts.length ? [t("conflicts", { tools: conflicts.join(", ") })] : []),
    ...(article?.tips ?? []).slice(0, 2).map(fill),
  ];
  const related = catalog
    .filter((other) => other.category === tool.category && other.id !== tool.id)
    .slice(0, 6);
  const faq = (article?.faq ?? []).map((item) => ({ q: fill(item.q), a: fill(item.a) }));
  const url = localizedUrl(locale, `/tools/${tool.id}`);

  return (
    <>
      <section className="page-head">
        <div className="container">
          <Breadcrumbs
            items={[
              { name: nav("home"), href: "/" },
              { name: t("breadcrumb"), href: "/tools" },
              { name: tool.name },
            ]}
          />
          <h1>{tool.name}</h1>
          <p className="lead">{tool.description}</p>
          <div className="meta-row">
            <PlanBadge plan={tool.plan} />
            <Link className="pill" href={`/tools#${tool.category}`}>
              {category}
            </Link>
          </div>
        </div>
      </section>

      <div className="container layout">
        <article className="prose">
          <h2>{t("how")}</h2>
          <p>
            <Inline text={fill(article?.intro ?? tool.description)} />
          </p>
          <p className="muted">{delivery(tool.alwaysOn ? "adminAlwaysOn" : tool.delivery)}</p>

          <h2>{t("where")}</h2>
          <ul>
            {tool.surfaces.map((s) => (
              <li key={s}>{surface(s)}</li>
            ))}
          </ul>

          {settings.length > 0 && (
            <>
              <h2>{t("settings")}</h2>
              <ul>
                {settings.slice(0, SETTINGS_SHOWN).map((row) => (
                  <li key={row.key}>{row.label}</li>
                ))}
              </ul>
              <p>
                <Link href={`/help/${tool.id}#settings`}>{t("moreSettings")}</Link>
              </p>
            </>
          )}

          {notes.length > 0 && (
            <>
              <h2>{t("notes")}</h2>
              <ul>
                {notes.map((note, index) => (
                  <li key={index}>
                    <Inline text={note} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {faq.length > 0 && (
            <>
              <h2>{t("faq")}</h2>
              <Faq items={faq} />
            </>
          )}

          <p style={{ marginTop: 32 }}>
            <Link className="btn btn-secondary" href={`/help/${tool.id}`}>
              {t("guide")}
            </Link>
          </p>
        </article>

        <aside className="aside">
          <div className="aside-sticky aside">
            <div className="card">
              <h2 style={{ fontSize: "1.05rem" }}>{t("plan")}</h2>
              <p className="muted">
                {t("priceNote", {
                  plan: common(`plan.${tool.plan}`),
                  price: usd(plan.monthly, locale),
                  days: trialDays,
                })}
              </p>
              <InstallButton />
            </div>
            {related.length > 0 && (
              <div className="card">
                <h2 style={{ fontSize: "1.05rem" }}>{t("related", { category })}</h2>
                <ul className="aside-list">
                  {related.map((other) => (
                    <li key={other.id}>
                      <Link href={`/tools/${other.id}`}>{other.name}</Link>
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
          breadcrumbSchema([
            { name: nav("home"), url: localizedUrl(locale, "/") },
            { name: t("breadcrumb"), url: localizedUrl(locale, "/tools") },
            { name: tool.name, url },
          ]),
          ...(faq.length > 0 ? [faqSchema(faq)] : []),
        ]}
      />
    </>
  );
}
