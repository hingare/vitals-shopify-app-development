import { routing } from "@/i18n/routing";
import { guides as enGuides } from "./en/guides";
import { ai } from "./en/tools/ai";
import { conversion } from "./en/tools/conversion";
import { marketing } from "./en/tools/marketing";
import { trust } from "./en/tools/trust";
import { upsell } from "./en/tools/upsell";
import type { Guide, ToolArticle } from "./types";

/**
 * The help center, per language. To translate it, add a folder like ./bn with the same shape and
 * list it here. A page that isn't translated yet shows the English text, and its canonical address
 * points at the English page so search engines index only the real versions.
 */
interface HelpContent {
  tools: Record<string, ToolArticle>;
  guides: Guide[];
}

const HELP: Record<string, HelpContent> = {
  en: { tools: { ...conversion, ...trust, ...upsell, ...marketing, ...ai }, guides: enGuides },
};

const FALLBACK = routing.defaultLocale;

function contentFor(locale: string): HelpContent {
  return HELP[locale] ?? HELP[FALLBACK]!;
}

/** Languages a help page is really written in (tool id or guide slug) */
export function helpLanguages(slug: string): string[] {
  return Object.entries(HELP)
    .filter(([, content]) => slug in content.tools || content.guides.some((g) => g.slug === slug))
    .map(([locale]) => locale);
}

export function getToolArticle(locale: string, id: string): ToolArticle | null {
  return contentFor(locale).tools[id] ?? HELP[FALLBACK]!.tools[id] ?? null;
}

export function getGuide(locale: string, slug: string): Guide | null {
  const find = (content: HelpContent) => content.guides.find((guide) => guide.slug === slug);
  return find(contentFor(locale)) ?? find(HELP[FALLBACK]!) ?? null;
}

/** Guides in the order they're listed in the help center */
export function getGuides(locale: string): Guide[] {
  const local = contentFor(locale).guides;
  const missing = HELP[FALLBACK]!.guides.filter((g) => !local.some((l) => l.slug === g.slug));
  return [...local, ...missing];
}

export function guideSlugs(): string[] {
  return HELP[FALLBACK]!.guides.map((guide) => guide.slug);
}

export function articleToolIds(): string[] {
  return Object.keys(HELP[FALLBACK]!.tools);
}

export type { Block, Guide, ToolArticle } from "./types";
