import { brand } from "@app/brand";
import { describe, expect, it } from "vitest";
import messages from "../../messages/en.json";
import { toolIds } from "@/lib/catalog";
import { blockTexts } from "@/lib/blocks";
import { factValues } from "@/lib/pricing";
import { plainText } from "@/lib/text";
import { posts } from "./blog";
import { comparisons } from "./compare";
import { articleToolIds, getGuides, getToolArticle, guideSlugs } from "./help";
import { getLegal, legalValues } from "./legal";

/**
 * Checks that every piece of site content is complete and that its links and placeholders work,
 * so a renamed tool, a removed guide or a typo in `{proPrice}` fails here instead of on the site.
 */

const LOCALE = "en";
const tools = toolIds();
const guides = guideSlugs();
const compareSlugs = comparisons.slugs();
const postSlugs = posts.slugs();

function toolArticleTexts(id: string): string[] {
  const article = getToolArticle(LOCALE, id);
  if (!article) return [];
  return [
    article.intro,
    ...article.setup,
    ...(article.after ?? []),
    ...(article.tips ?? []),
    ...(article.faq ?? []).flatMap((item) => [item.q, item.a]),
  ];
}

/** Every text that is filled with plan facts, by where it comes from */
const factTexts: Array<[string, string[]]> = [
  ...tools.map((id): [string, string[]] => [`tool ${id}`, toolArticleTexts(id)]),
  ...getGuides(LOCALE).map((guide): [string, string[]] => [
    `guide ${guide.slug}`,
    [guide.title, guide.description, ...blockTexts(guide.body)],
  ]),
  ...comparisons
    .all(LOCALE)
    .map((item): [string, string[]] => [
      `comparison ${item.slug}`,
      [item.title, item.description, ...blockTexts(item.body)],
    ]),
  ...posts
    .all(LOCALE)
    .map((post): [string, string[]] => [
      `post ${post.slug}`,
      [post.title, post.description, ...blockTexts(post.body)],
    ]),
];

const legalTexts: Array<[string, string[]]> = (["privacy", "terms"] as const).map((page) => {
  const doc = getLegal(LOCALE, page);
  return [`legal ${page}`, [doc.title, doc.description, ...blockTexts(doc.body)]];
});

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const PAGES = new Set([
  "/",
  "/tools",
  "/features",
  "/pricing",
  "/compare",
  "/help",
  "/blog",
  "/privacy",
  "/terms",
]);

function linkWorks(href: string): boolean {
  if (!href.startsWith("/")) return /^(https?:|mailto:)/.test(href);
  const path = href.split("#")[0]!;
  if (PAGES.has(path)) return true;
  const [, section, slug, ...rest] = path.split("/");
  if (rest.length > 0 || !slug) return false;
  if (section === "tools") return tools.includes(slug);
  if (section === "help") return tools.includes(slug) || guides.includes(slug);
  if (section === "compare") return compareSlugs.includes(slug);
  if (section === "blog") return postSlugs.includes(slug);
  return false;
}

/** `{name}` placeholders outside `code`: those inside code are the app's own, shown as examples */
function placeholders(text: string): string[] {
  const outsideCode = text.replace(/`[^`]*`/g, "");
  return [...outsideCode.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);
}

describe("help articles", () => {
  it("cover every tool, and only real tools", () => {
    expect(tools.filter((id) => !articleToolIds().includes(id))).toEqual([]);
    expect(articleToolIds().filter((id) => !tools.includes(id))).toEqual([]);
  });

  it("give every tool an intro and at least one setup step unless it has none to give", () => {
    for (const id of tools) {
      const article = getToolArticle(LOCALE, id)!;
      expect(article.intro.trim(), id).not.toBe("");
      expect(
        article.setup.every((step) => step.trim() !== ""),
        id,
      ).toBe(true);
    }
  });

  it("use guide slugs that are unique and never a tool id", () => {
    expect(new Set(guides).size).toBe(guides.length);
    expect(guides.filter((slug) => tools.includes(slug))).toEqual([]);
  });

  it("only point to related articles that exist", () => {
    const related = [
      ...tools.flatMap((id) => getToolArticle(LOCALE, id)?.related ?? []),
      ...getGuides(LOCALE).flatMap((guide) => guide.related ?? []),
    ];
    expect(related.filter((ref) => !tools.includes(ref) && !guides.includes(ref))).toEqual([]);
  });
});

describe("site content", () => {
  const everything: Array<[string, string[]]> = [
    ...factTexts,
    ...legalTexts,
    ["messages", allStrings(messages)],
  ];

  it("only links to pages that exist", () => {
    const broken = everything.flatMap(([source, texts]) =>
      texts.flatMap((text) =>
        [...text.matchAll(LINK)]
          .map((match) => match[2]!)
          .filter((href) => !linkWorks(href))
          .map((href) => `${source}: ${href}`),
      ),
    );
    expect(broken).toEqual([]);
  });

  it("only uses markup the site can show, so no stray ** or ]( reaches a page", () => {
    const stray = everything.flatMap(([source, texts]) =>
      texts
        .filter((text) => /\*\*|\]\(|`/.test(plainText(text)))
        .map((text) => `${source}: ${text.slice(0, 80)}`),
    );
    expect(stray).toEqual([]);
  });

  it("only uses placeholders that have a value", () => {
    const facts = factValues(LOCALE);
    const legal = legalValues(LOCALE);
    const unknown = [
      ...factTexts.map(([source, texts]): [string, string[], Record<string, string>] => [
        source,
        texts,
        facts,
      ]),
      ...legalTexts.map(([source, texts]): [string, string[], Record<string, string>] => [
        source,
        texts,
        legal,
      ]),
    ].flatMap(([source, texts, values]) =>
      texts.flatMap((text) =>
        placeholders(text)
          .filter((name) => !(name in values))
          .map((name) => `${source}: {${name}}`),
      ),
    );
    expect(unknown).toEqual([]);
  });

  it("names the app through {brand}, so renaming it is one change in the brand config", () => {
    const hardcoded = [...factTexts, ...legalTexts]
      .filter(([, texts]) => texts.some((text) => text.includes(brand.name)))
      .map(([source]) => source);
    expect(hardcoded).toEqual([]);
  });

  it("dates comparisons and posts as real calendar days", () => {
    const dates = [
      ...comparisons.all(LOCALE).map((item) => item.updated),
      ...posts.all(LOCALE).flatMap((post) => [post.published, post.updated]),
      getLegal(LOCALE, "privacy").updated,
      getLegal(LOCALE, "terms").updated,
    ];
    for (const date of dates) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(date);
    }
  });

  it("uses unique slugs for comparisons and posts", () => {
    expect(new Set(compareSlugs).size).toBe(compareSlugs.length);
    expect(new Set(postSlugs).size).toBe(postSlugs.length);
  });
});
