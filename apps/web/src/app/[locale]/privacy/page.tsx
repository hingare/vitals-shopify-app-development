import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalArticle, legalMetadata } from "@/components/LegalArticle";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/privacy">): Promise<Metadata> {
  const { locale } = await params;
  return legalMetadata(locale, "privacy");
}

export default async function PrivacyPage({ params }: PageProps<"/[locale]/privacy">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalArticle locale={locale} page="privacy" />;
}
