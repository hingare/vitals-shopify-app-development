import { defineRouting } from "next-intl/routing";

/**
 * Website languages. English pages have no prefix (/pricing); other languages get one (/bn/pricing).
 *
 * To add a language:
 * 1. Add its code here, for example ["en", "bn"].
 * 2. Copy messages/en.json to messages/<code>.json and translate it.
 * 3. Tool names, descriptions and setting labels come from @app/i18n, so add the language there too.
 * 4. Long texts (help articles, blog, legal pages) fall back to English until a translation is added
 *    under src/content. Untranslated pages are left out of hreflang and the sitemap for that language.
 *
 * No cookie and no automatic redirect by browser language: a visitor stays on the language of the
 * link they opened, and the language menu switches it.
 */
export const routing = defineRouting({
  locales: ["en"],
  defaultLocale: "en",
  localePrefix: "as-needed",
  localeDetection: false,
  localeCookie: false,
});

export type SiteLocale = (typeof routing.locales)[number];
