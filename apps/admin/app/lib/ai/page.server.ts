import { FetchBlockedError, safeFetch } from "../safe-fetch.server";
import { AiError } from "./errors";
import { htmlToText } from "./text";

/** একটা পেজের যে তথ্য অডিট আর ইমপোর্টের কাজে লাগে (HTML পার্স করে, কোনো স্ক্রিপ্ট না চালিয়ে) */
export interface PageFacts {
  url: string;
  title: string;
  metaDescription: string;
  canonical: string;
  headings: string[];
  images: number;
  imagesWithoutAlt: number;
  jsonLdTypes: string[];
  jsonLd: unknown[];
  ogImage: string;
  text: string;
  words: number;
}

const attr = (tag: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(2).find(Boolean) ??
  "";

function metaContent(html: string, key: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if ([attr(tag, "name"), attr(tag, "property")].some((v) => v.toLowerCase() === key)) {
      return attr(tag, "content");
    }
  }
  return "";
}

function collectTypes(value: unknown, out: Set<string>) {
  if (Array.isArray(value)) value.forEach((v) => collectTypes(v, out));
  else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const type = record["@type"];
    if (typeof type === "string") out.add(type);
    if (Array.isArray(type)) type.forEach((t) => typeof t === "string" && out.add(t));
    if (record["@graph"]) collectTypes(record["@graph"], out);
  }
}

export function pageFacts(url: string, html: string): PageFacts {
  const jsonLd: unknown[] = [];
  for (const match of html.matchAll(
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      jsonLd.push(JSON.parse(match[1] ?? ""));
    } catch {
      // ভাঙা JSON-LD বাদ (অডিটে এটাও একটা সমস্যা হিসেবে ধরা পড়ে না, কারণ ধরন গোনা হয় না)
    }
  }
  const types = new Set<string>();
  jsonLd.forEach((item) => collectTypes(item, types));
  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const text = htmlToText(body, 8_000);
  const canonical = (html.match(/<link\b[^>]*>/gi) ?? []).find((tag) =>
    /\brel\s*=\s*["']?canonical/i.test(tag),
  );
  return {
    url,
    title: htmlToText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "", 300),
    metaDescription: metaContent(html, "description"),
    canonical: canonical ? attr(canonical, "href") : "",
    headings: [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)]
      .map((m) => `H${m[1]}: ${htmlToText(m[2] ?? "", 200)}`)
      .filter((h) => h.length > 4)
      .slice(0, 30),
    images: images.length,
    imagesWithoutAlt: images.filter((tag) => !attr(tag, "alt").trim()).length,
    jsonLdTypes: [...types],
    jsonLd,
    ogImage: metaContent(html, "og:image"),
    text,
    words: text.split(/\s+/).filter(Boolean).length,
  };
}

/** পেজ আনে; ব্লক বা না পেলে মার্চেন্টের বোঝার মতো ত্রুটি */
export async function fetchPage(url: string): Promise<PageFacts> {
  try {
    const result = await safeFetch(url);
    if (result.status === 401 || result.status === 403)
      throw new AiError("not_found", "Page is protected");
    if (result.status >= 400) throw new AiError("not_found", `HTTP ${result.status}`);
    if (!/html|xml/i.test(result.contentType)) throw new AiError("not_found", "Not a web page");
    return pageFacts(result.url, result.body);
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof FetchBlockedError) throw new AiError("not_found", error.message);
    throw new AiError("not_found", error instanceof Error ? error.message : String(error));
  }
}
