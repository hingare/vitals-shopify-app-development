import { brand } from "@app/brand";

/** The live address of the website, without a trailing slash. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || brand.website).replace(
  /\/+$/,
  "",
);

/** Full address for a path on this site, for canonical links, sitemaps and structured data. */
export function absoluteUrl(path = "/"): string {
  return new URL(path, `${SITE_URL}/`).toString();
}

/** Where the main button sends people: the App Store listing, or an email while in private beta. */
export function installHref(): string {
  if (brand.appStoreUrl) return brand.appStoreUrl;
  const subject = encodeURIComponent(`${brand.name} private beta`);
  return `mailto:${brand.supportEmail}?subject=${subject}`;
}

export const isListed = () => Boolean(brand.appStoreUrl);

/** The date the content was last reviewed. Shown on help articles and used in structured data. */
export const CONTENT_UPDATED = "2026-11-14";
