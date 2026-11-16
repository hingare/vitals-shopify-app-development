import type { Metadata } from "next";
import { brand } from "@app/brand";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CtaBand } from "@/components/CtaBand";
import { Faq } from "@/components/Faq";
import { Icon } from "@/components/Icon";
import { InstallButton } from "@/components/InstallButton";
import { JsonLd } from "@/components/JsonLd";
import { PlanCards } from "@/components/PlanCards";
import { Link } from "@/i18n/navigation";
import { getCategories, getTool, planCounts, toolIds } from "@/lib/catalog";
import { lowestMonthly, planFacts, trialDays, usd } from "@/lib/pricing";
import { faqSchema, softwareSchema } from "@/lib/schema";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return pageMetadata({
    locale,
    path: "/",
    title: `${brand.name}: ${brand.tagline}`,
    description: t("description", { count: toolIds().length }),
  });
}

/** Tools shown in the mock app panel in the hero, in this order */
const PANEL = [
  { id: "sticky-atc", icon: "conversion", state: "on" },
  { id: "product-reviews", icon: "reviews", state: "on" },
  { id: "free-gifts", icon: "upsell", state: "on" },
  { id: "ai-descriptions", icon: "ai", state: "open" },
] as const;

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const common = await getTranslations("common");
  const count = toolIds().length;
  const counts = planCounts();
  const categories = getCategories(locale);
  const pro = planFacts().find((plan) => plan.id === "professional");
  const num = new Intl.NumberFormat(locale);

  const faq = [1, 2, 3, 4, 5, 6].map((n) => ({
    q: t(`faq${n}Q`),
    a: t(`faq${n}A`, { starter: counts.starter, all: counts.professional }),
  }));

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">{t("eyebrow")}</span>
            <h1>{t("title")}</h1>
            <p className="lead">{t("lead", { count })}</p>
            <div className="btn-row">
              <InstallButton />
              <Link className="btn btn-secondary" href="/tools">
                {t("secondary", { count })}
              </Link>
            </div>
            <p className="hero-note">
              {t("note", { days: trialDays, price: usd(lowestMonthly(), locale) })}
            </p>
          </div>
          <div className="panel" aria-hidden="true">
            <div className="panel-title">
              <span>{t("panelTitle")}</span>
              <span className="panel-dots">
                <span />
                <span />
                <span />
              </span>
            </div>
            {PANEL.map((row) => {
              const tool = getTool(locale, row.id);
              if (!tool) return null;
              return (
                <div className="panel-row" key={row.id}>
                  <span className="panel-icon">
                    <Icon name={row.icon} size={18} />
                  </span>
                  <span>
                    <span className="panel-name">{tool.name}</span>
                    <br />
                    <span className="panel-meta">{common(`plan.${tool.plan}`)}</span>
                  </span>
                  {row.state === "on" ? (
                    <span className="switch" title={t("panelOn")} />
                  ) : (
                    <span className="pill">{t("panelOpen")}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2>{t("categoriesTitle")}</h2>
            <p className="lead">{t("categoriesLead")}</p>
          </div>
          <div className="grid grid-3">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/tools#${category.id}`}
                className="card card-link"
                aria-label={t("seeCategory", { category: category.name })}
              >
                <span className="card-icon">
                  <Icon name={category.id} />
                </span>
                <h3>{category.name}</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {common("toolCount", { count: category.tools.length })}
                </p>
                <ul className="tag-list">
                  {category.tools.slice(0, 4).map((tool) => (
                    <li key={tool.id}>{tool.name}</li>
                  ))}
                </ul>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="section-head">
            <h2>{t("speedTitle")}</h2>
            <p className="lead">{t("speedLead")}</p>
          </div>
          <div className="grid grid-4">
            {(["bolt", "sliders", "shield", "speed"] as const).map((icon, i) => (
              <div className="card" key={icon}>
                <span className="card-icon">
                  <Icon name={icon} />
                </span>
                <h3>{t(`speed${i + 1}Title`)}</h3>
                <p className="muted">{t(`speed${i + 1}Body`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid grid-2" style={{ alignItems: "start", gap: 48 }}>
          <div>
            <h2>{t("honestTitle")}</h2>
            <p className="lead">{t("honestLead")}</p>
          </div>
          <ul className="check-list">
            {[1, 2, 3, 4].map((n) => (
              <li key={n}>{t(`honest${n}`)}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="section-head">
            <h2>{t("oneTitle")}</h2>
          </div>
          <div className="grid grid-4">
            {(["bill", "sliders", "check", "trash"] as const).map((icon, i) => (
              <div className="card" key={icon}>
                <span className="card-icon">
                  <Icon name={icon} />
                </span>
                <h3>{t(`one${i + 1}Title`)}</h3>
                <p className="muted">{t(`one${i + 1}Body`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2>{t("aiTitle")}</h2>
            <p className="lead">
              {t("aiLead", { credits: num.format(pro?.aiCredits ?? 0) })}
            </p>
          </div>
          <div className="grid grid-4">
            {(["chat", "chart", "image", "eye"] as const).map((icon, i) => (
              <div className="card" key={icon}>
                <span className="card-icon">
                  <Icon name={icon} />
                </span>
                <h3>{t(`ai${i + 1}Title`)}</h3>
                <p className="muted">{t(`ai${i + 1}Body`)}</p>
              </div>
            ))}
          </div>
          <div className="callout" style={{ marginTop: 28 }}>
            <p>
              <strong>{t("assistantTitle")}.</strong> {t("assistantBody")}
            </p>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="section-head">
            <h2>{t("pricingTitle")}</h2>
          </div>
          <PlanCards locale={locale} />
          <p style={{ marginTop: 20 }}>
            <Link href="/pricing">{t("pricingLink")}</Link>
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2>{t("faqTitle")}</h2>
          </div>
          <Faq items={faq} />
        </div>
      </section>

      <CtaBand />

      <JsonLd data={[softwareSchema(t("lead", { count })), faqSchema(faq)]} />
    </>
  );
}
