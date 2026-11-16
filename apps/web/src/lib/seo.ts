import type { Metadata } from "next";
import { brand } from "@app/brand";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { absoluteUrl } from "./site";

/** Social preview image (made in app/og-image.png/route.tsx) */
export const OG_IMAGE = { url: absoluteUrl("/og-image.png"), width: 1200, height: 630 };

/** The address of a page in a language, as visitors see it (English has no prefix). */
export function localizedPath(locale: string, path: string): string {
  return getPathname({ locale, href: path });
}

export function localizedUrl(locale: string, path: string): string {
  return absoluteUrl(localizedPath(locale, path));
}

/**
 * hreflang links. Only languages the page really exists in are listed, so an untranslated page
 * never points search engines at an English copy under another language's address.
 */
export function languageAlternates(
  path: string,
  available: readonly string[] = routing.locales,
): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of available) languages[locale] = localizedUrl(locale, path);
  languages["x-default"] = localizedUrl(routing.defaultLocale, path);
  return languages;
}

interface PageMeta {
  locale: string;
  path: string;
  title: string;
  description: string;
  /** Languages this page is translated into (all site languages if left out) */
  available?: readonly string[];
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
}

export function pageMetadata(meta: PageMeta): Metadata {
  const url = localizedUrl(meta.locale, meta.path);
  // A page shown in English under another language's address points search engines at the
  // English original, so only real translations get indexed.
  const translated = !meta.available || meta.available.includes(meta.locale);
  const canonical = translated ? url : localizedUrl(routing.defaultLocale, meta.path);
  return {
    title: meta.title,
    description: meta.description,
    // Page metadata replaces the layout's openGraph and alternates instead of merging, so the
    // image and the llms.txt link are repeated here.
    alternates: {
      canonical,
      languages: languageAlternates(meta.path, meta.available),
      types: { "text/plain": absoluteUrl("/llms.txt") },
    },
    openGraph: {
      type: meta.type ?? "website",
      url,
      title: meta.title,
      description: meta.description,
      siteName: brand.name,
      images: [{ ...OG_IMAGE, alt: brand.name }],
      ...(meta.publishedTime ? { publishedTime: meta.publishedTime } : {}),
      ...(meta.modifiedTime ? { modifiedTime: meta.modifiedTime } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [OG_IMAGE.url],
    },
  };
}
