import { brand } from "@app/brand";
import { planFacts } from "./pricing";
import { absoluteUrl } from "./site";

/**
 * Structured data (schema.org JSON-LD). Only facts the site can stand behind: no ratings or review
 * counts until real reviews exist on the App Store.
 */
type Json = Record<string, unknown>;

export function organizationSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": absoluteUrl("/#organization"),
    name: brand.name,
    url: absoluteUrl("/"),
    logo: absoluteUrl("/icon.svg"),
    email: brand.supportEmail,
    ...(brand.social.length ? { sameAs: brand.social } : {}),
  };
}

export function websiteSchema(locale: string): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": absoluteUrl("/#website"),
    name: brand.name,
    url: absoluteUrl("/"),
    inLanguage: locale,
    publisher: { "@id": absoluteUrl("/#organization") },
  };
}

export function softwareSchema(description: string): Json {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": absoluteUrl("/#app"),
    name: brand.name,
    description,
    url: absoluteUrl("/"),
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web (Shopify admin)",
    publisher: { "@id": absoluteUrl("/#organization") },
    offers: planFacts().map((plan) => ({
      "@type": "Offer",
      name: plan.id === "starter" ? "Starter" : "Professional",
      price: plan.monthly.toFixed(2),
      priceCurrency: "USD",
      url: absoluteUrl("/pricing"),
    })),
  };
}

export function breadcrumbSchema(items: Array<{ name: string; url: string }>): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function faqSchema(items: Array<{ q: string; a: string }>): Json {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function articleSchema(article: {
  type?: "Article" | "TechArticle" | "BlogPosting";
  headline: string;
  description: string;
  url: string;
  locale: string;
  datePublished: string;
  dateModified: string;
}): Json {
  return {
    "@context": "https://schema.org",
    "@type": article.type ?? "Article",
    headline: article.headline,
    description: article.description,
    url: article.url,
    mainEntityOfPage: article.url,
    inLanguage: article.locale,
    datePublished: article.datePublished,
    dateModified: article.dateModified,
    author: { "@id": absoluteUrl("/#organization") },
    publisher: { "@id": absoluteUrl("/#organization") },
  };
}
