/** The tiny markup used in site content: **bold**, [text](link) and `code`. Bold may hold a link. */
export const INLINE_TOKEN = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;

/** The same text without markup, for meta descriptions, structured data, llms.txt and search */
export function plainText(text: string): string {
  return text.replace(
    INLINE_TOKEN,
    (
      _match,
      bold: string | undefined,
      label: string | undefined,
      _href,
      code: string | undefined,
    ) => (bold === undefined ? (label ?? code ?? "") : plainText(bold)),
  );
}

/** Rough reading time for an article, at 220 words a minute */
export function readingMinutes(texts: string[]): number {
  const words = texts.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/**
 * Fills `{name}` placeholders from `values`. Unknown names are left alone, because help text also
 * shows the app's own placeholders, like `{product}`, to merchants.
 */
export function fillFacts(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** Shortens text for meta descriptions, cutting at a word and adding an ellipsis */
export function clip(text: string, max = 160): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

/** A content date (YYYY-MM-DD) written out for readers, like "November 16, 2026" */
export function formatDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}
