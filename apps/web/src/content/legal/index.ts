import { brand } from "@app/brand";
import { routing } from "@/i18n/routing";
import { factValues } from "@/lib/pricing";
import { fillFacts } from "@/lib/text";
import type { LegalDoc } from "../types";
import * as en from "./en";

interface LegalContent {
  privacy: LegalDoc;
  terms: LegalDoc;
  governingLawFallback: string;
}

/** Privacy Policy and Terms, per language. Add a language by adding its file here. */
const LEGAL: Record<string, LegalContent> = { en };

export type LegalPageId = "privacy" | "terms";

function contentFor(locale: string): LegalContent {
  return LEGAL[locale] ?? LEGAL[routing.defaultLocale]!;
}

export function getLegal(locale: string, page: LegalPageId): LegalDoc {
  return contentFor(locale)[page];
}

/** Languages the legal pages are written in, for hreflang */
export function legalLanguages(): string[] {
  return Object.keys(LEGAL);
}

/** The plan facts plus the company details from the brand config */
export function legalValues(locale: string): Record<string, string> {
  const { companyName, address, governingLaw, privacyEmail } = brand.legal;
  const company = { company: companyName };
  return {
    ...factValues(locale),
    ...company,
    companyLine: address ? `${companyName}, ${address}` : companyName,
    governingLaw: governingLaw || fillFacts(contentFor(locale).governingLawFallback, company),
    privacyEmail,
    supportEmail: brand.supportEmail,
  };
}
