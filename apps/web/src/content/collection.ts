import { routing } from "@/i18n/routing";

/**
 * Pages written separately for each language, like comparisons and blog posts. Every page is
 * written in the default language first. A language that doesn't have a page yet shows the default
 * language's version, and `languages()` lists only real translations, for hreflang.
 */
export function contentCollection<T extends { slug: string }>(byLocale: Record<string, T[]>) {
  const fallback = byLocale[routing.defaultLocale] ?? [];

  function all(locale: string): T[] {
    const local = byLocale[locale] ?? [];
    const missing = fallback.filter((item) => !local.some((own) => own.slug === item.slug));
    return [...local, ...missing];
  }

  return {
    all,
    get: (locale: string, slug: string): T | null =>
      all(locale).find((item) => item.slug === slug) ?? null,
    slugs: (): string[] => fallback.map((item) => item.slug),
    languages: (slug: string): string[] =>
      Object.entries(byLocale)
        .filter(([, items]) => items.some((item) => item.slug === slug))
        .map(([locale]) => locale),
  };
}
