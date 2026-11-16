import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CtaBand } from "@/components/CtaBand";
import { Icon, type IconName } from "@/components/Icon";
import { JsonLd } from "@/components/JsonLd";
import { Link } from "@/i18n/navigation";
import { getCatalog, toolIds } from "@/lib/catalog";
import { planFacts } from "@/lib/pricing";
import { breadcrumbSchema } from "@/lib/schema";
import { localizedUrl, pageMetadata } from "@/lib/seo";

/** Each feature, its icon and the guide that explains it */
const FEATURES: Array<{ key: string; icon: IconName; guide: string }> = [
  { key: "analytics", icon: "chart", guide: "analytics" },
  { key: "offers", icon: "upsell", guide: "offers" },
  { key: "reviews", icon: "reviews", guide: "managing-reviews" },
  { key: "marketing", icon: "mail", guide: "email-sending" },
  { key: "ai", icon: "ai", guide: "ai-credits" },
  { key: "visibility", icon: "search", guide: "ai-visibility" },
  { key: "assistants", icon: "chat", guide: "ai-assistants" },
  { key: "speed", icon: "speed", guide: "speed-guard" },
  { key: "placement", icon: "sliders", guide: "widget-placement" },
  { key: "sections", icon: "platform", guide: "theme-sections" },
  { key: "privacy", icon: "shield", guide: "privacy-data" },
];

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/features">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "features" });
  return pageMetadata({
    locale,
    path: "/features",
    title: t("metaTitle"),
    description: t("lead", { count: toolIds().length }),
  });
}

export default async function FeaturesPage({ params }: PageProps<"/[locale]/features">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("features");
  const nav = await getTranslations("nav");
  const common = await getTranslations("common");
  const num = new Intl.NumberFormat(locale);
  const pro = planFacts().find((plan) => plan.id === "professional")!;
  // AI Studio tools: the AI category's Professional tools (the Starter ones are SEO helpers)
  const aiTools = getCatalog(locale).filter(
    (tool) => tool.category === "ai" && tool.plan === "professional",
  ).length;
  const values = { emails: num.format(pro.emails), count: aiTools };

  return (
    <>
      <section className="page-head">
        <div className="container">
          <Breadcrumbs items={[{ name: nav("home"), href: "/" }, { name: nav("features") }]} />
          <h1>{t("title")}</h1>
          <p className="lead">{t("lead", { count: toolIds().length })}</p>
        </div>
      </section>

      <section className="section">
        <div className="container grid grid-2">
          {FEATURES.map((feature) => (
            <div key={feature.key} className="card" id={feature.key}>
              <span className="card-icon">
                <Icon name={feature.icon} />
              </span>
              <h2 style={{ fontSize: "1.25rem" }}>{t(`${feature.key}Title`)}</h2>
              <p className="muted">{t(`${feature.key}Body`, values)}</p>
              <Link href={`/help/${feature.guide}`}>{common("readGuide")}</Link>
            </div>
          ))}
        </div>
      </section>

      <CtaBand />

      <JsonLd
        data={breadcrumbSchema([
          { name: nav("home"), url: localizedUrl(locale, "/") },
          { name: nav("features"), url: localizedUrl(locale, "/features") },
        ])}
      />
    </>
  );
}
