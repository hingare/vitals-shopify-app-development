import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

/**
 * AI crawlers are welcome, search, on-request and training alike: we want AI assistants to find,
 * read and quote this site. They're named one by one so the intent is clear; a crawler with its
 * own group ignores the `*` group, so every group repeats the same rules.
 */
const AI_CRAWLERS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot",
  "Applebot-Extended",
  "Bingbot",
  "DuckAssistBot",
  "meta-externalagent",
  "Amazonbot",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  const rules = { allow: "/", disallow: "/api/" };
  return {
    rules: [
      { userAgent: AI_CRAWLERS, ...rules },
      { userAgent: "*", ...rules },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
