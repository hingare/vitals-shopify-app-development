import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalArticle, legalMetadata } from "@/components/LegalArticle";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/terms">): Promise<Metadata> {
  const { locale } = await params;
  return legalMetadata(locale, "terms");
}

export default async function TermsPage({ params }: PageProps<"/[locale]/terms">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalArticle locale={locale} page="terms" />;
}
