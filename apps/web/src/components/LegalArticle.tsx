import type { Metadata } from "next";
import { brand } from "@app/brand";
import { getTranslations } from "next-intl/server";
import { getLegal, legalLanguages, legalValues, type LegalPageId } from "@/content/legal";
import { breadcrumbSchema } from "@/lib/schema";
import { localizedUrl, pageMetadata } from "@/lib/seo";
import { fillFacts, formatDate, plainText } from "@/lib/text";
import { Blocks } from "./Blocks";
import { Breadcrumbs } from "./Breadcrumbs";
import { JsonLd } from "./JsonLd";

export function legalMetadata(locale: string, page: LegalPageId): Metadata {
  const doc = getLegal(locale, page);
  return pageMetadata({
    locale,
    path: `/${page}`,
    title: doc.title,
    description: plainText(fillFacts(doc.description, legalValues(locale))),
    available: legalLanguages(),
    modifiedTime: doc.updated,
  });
}

/** The Privacy Policy or the Terms, with a draft notice until a lawyer has reviewed them */
export async function LegalArticle({ locale, page }: { locale: string; page: LegalPageId }) {
  const doc = getLegal(locale, page);
  const values = legalValues(locale);
  const fill = (text: string) => fillFacts(text, values);
  const t = await getTranslations("legal");
  const nav = await getTranslations("nav");

  return (
    <>
      <section className="page-head">
        <div className="container">
          <Breadcrumbs items={[{ name: nav("home"), href: "/" }, { name: doc.title }]} />
          <h1>{doc.title}</h1>
          <p className="muted">{t("updated", { date: formatDate(doc.updated, locale) })}</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <article className="prose">
            {!brand.legal.reviewed && (
              <div className="callout callout-warning">
                <p>{t("draft")}</p>
              </div>
            )}
            <Blocks blocks={doc.body} fill={fill} />
          </article>
        </div>
      </section>

      <JsonLd
        data={breadcrumbSchema([
          { name: nav("home"), url: localizedUrl(locale, "/") },
          { name: doc.title, url: localizedUrl(locale, `/${page}`) },
        ])}
      />
    </>
  );
}
