import type { ReactNode } from "react";

/**
 * The real layout with <html> lives in [locale]/layout.tsx, so the page language is set per locale.
 * This file only has to exist for files outside [locale] (robots.txt, sitemap, llms.txt, the API).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
