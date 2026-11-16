import type { MetadataRoute } from "next";
import { latestPosts, posts } from "@/content/blog";
import { comparisons } from "@/content/compare";
import { guideSlugs, helpLanguages } from "@/content/help";
import { getLegal, legalLanguages } from "@/content/legal";
import { routing } from "@/i18n/routing";
import { toolIds } from "@/lib/catalog";
import { languageAlternates, localizedUrl } from "@/lib/seo";
import { CONTENT_UPDATED } from "@/lib/site";

/**
 * Every page, once for each language it's really written in. Untranslated pages point search
 * engines at the default language (see pageMetadata), so they're left out here too.
 */
function entries(
  path: string,
  lastModified: string,
  available: readonly string[] = routing.locales,
): MetadataRoute.Sitemap {
  const languages = languageAlternates(path, available);
  return available.map((locale) => ({
    url: localizedUrl(locale, path),
    lastModified,
    alternates: { languages },
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  const defaultLocale = routing.defaultLocale;
  const newestPost = latestPosts(defaultLocale)[0];
  return [
    ...["/", "/tools", "/features", "/pricing", "/help", "/compare"].flatMap((path) =>
      entries(path, CONTENT_UPDATED),
    ),
    ...entries("/blog", newestPost?.updated ?? CONTENT_UPDATED),
    ...toolIds().flatMap((id) => [
      ...entries(`/tools/${id}`, CONTENT_UPDATED),
      ...entries(`/help/${id}`, CONTENT_UPDATED, helpLanguages(id)),
    ]),
    ...guideSlugs().flatMap((slug) =>
      entries(`/help/${slug}`, CONTENT_UPDATED, helpLanguages(slug)),
    ),
    ...comparisons
      .all(defaultLocale)
      .flatMap((item) =>
        entries(`/compare/${item.slug}`, item.updated, comparisons.languages(item.slug)),
      ),
    ...posts
      .all(defaultLocale)
      .flatMap((post) => entries(`/blog/${post.slug}`, post.updated, posts.languages(post.slug))),
    ...(["privacy", "terms"] as const).flatMap((page) =>
      entries(`/${page}`, getLegal(defaultLocale, page).updated, legalLanguages()),
    ),
  ];
}
