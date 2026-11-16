/** The tiny markup used in site content: **bold** and [text](link). */
export const INLINE_TOKEN = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** The same text without markup, for meta descriptions, structured data, llms.txt and search */
export function plainText(text: string): string {
  return text.replace(
    INLINE_TOKEN,
    (_match, bold: string | undefined, label: string | undefined) => bold ?? label ?? "",
  );
}

/** Rough reading time for an article, at 220 words a minute */
export function readingMinutes(texts: string[]): number {
  const words = texts.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
