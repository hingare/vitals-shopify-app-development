import { brand } from "@app/brand";
import { getTranslations } from "next-intl/server";
import { latestPosts } from "@/content/blog";
import { comparisons } from "@/content/compare";
import { getGuides, getToolArticle } from "@/content/help";
import type { Block } from "@/content/help/types";
import { routing } from "@/i18n/routing";
import { getCategories, getSettings, type CatalogTool, type SettingRow } from "./catalog";
import { toolSteps } from "./help";
import { factValues } from "./pricing";
import { localizedUrl } from "./seo";
import { absoluteUrl } from "./site";
import { fillFacts, plainText } from "./text";

/**
 * /llms.txt (a short map of the site for AI assistants) and /llms-full.txt (every help article in
 * one file). Both are built from the same content as the pages, in the default language, so they
 * can't say anything the site doesn't.
 */

const LOCALE = routing.defaultLocale;

/** Site links in content are relative; AI assistants need full addresses */
function absoluteLinks(text: string): string {
  return text.replace(/\]\((\/[^)\s]*)\)/g, (_match, path: string) => `](${absoluteUrl(path)})`);
}

function makeFill(): (text: string) => string {
  const facts = factValues(LOCALE);
  return (text) => absoluteLinks(fillFacts(text, facts));
}

const url = (path: string) => localizedUrl(LOCALE, path);

function summary(fill: (text: string) => string): string[] {
  return [
    `# ${brand.name}`,
    "",
    fill(
      `> ${brand.tagline}. {brand} is a Shopify app with {proTools} tools for conversion, trust, offers, reviews, marketing, SEO and AI. Starter costs {starterPrice} a month with {starterTools} tools; Professional costs {proPrice} a month with all {proTools} tools. Both have a {trialDays}-day free trial and no usage fees.`,
    ),
    "",
    fill(
      "- Billing goes through Shopify. Uninstalling cancels the subscription at once, and the app leaves the theme automatically.",
    ),
    fill(
      "- Professional includes {aiCredits} AI credits, {emails} emails and {recordings} visitor recordings a month. When one runs out, that feature pauses until next month; nothing costs extra.",
    ),
    "- One script of under 5 KB loads after the page, then only the tools that are switched on.",
    "- No fake urgency: countdowns use real end dates, stock messages use real inventory and recent sales are real orders.",
    `- Support: ${brand.supportEmail}`,
  ];
}

function markdownTable(headers: string[], rows: string[][]): string {
  const cell = (text: string) => text.replace(/\|/g, "\\|");
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

function blocksText(blocks: Block[], fill: (text: string) => string): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "p":
          return fill(block.text);
        case "h2":
          return `### ${fill(block.text)}`;
        case "note":
          return `> ${fill(block.text)}`;
        case "steps":
          return block.items.map((item, index) => `${index + 1}. ${fill(item)}`).join("\n");
        case "list":
          return block.items.map((item) => `- ${fill(item)}`).join("\n");
        case "faq":
          return block.items.map((item) => `Q: ${fill(item.q)}\nA: ${fill(item.a)}`).join("\n\n");
        case "table":
          return markdownTable(block.headers.map(fill), block.rows.map((row) => row.map(fill)));
      }
    })
    .join("\n\n");
}

function settingLines(rows: SettingRow[], depth = 0): string[] {
  return rows.flatMap((row) => {
    const indent = "  ".repeat(depth);
    if (row.kind === "group") return [`${indent}- ${row.label}:`, ...settingLines(row.children, depth + 1)];
    const options = row.options.length ? ` Options: ${row.options.join(", ")}.` : "";
    const help = row.help ? ` ${row.help}` : "";
    return [`${indent}- ${row.label} (starts as ${row.defaultText}).${options}${help}`];
  });
}

/** The short map: what the app is, then every page worth reading, one line each */
export async function llmsText(): Promise<string> {
  const fill = makeFill();
  const common = await getTranslations({ locale: LOCALE, namespace: "common" });
  const nav = await getTranslations({ locale: LOCALE, namespace: "nav" });
  const footer = await getTranslations({ locale: LOCALE, namespace: "footer" });
  const lines = [...summary(fill), "", "## Pages", ""];
  lines.push(
    `- [${nav("tools")}](${url("/tools")}): every tool by category, with the plan it's in`,
    `- [${nav("features")}](${url("/features")}): analytics, offers, reviews, email, AI and more`,
    `- [${nav("pricing")}](${url("/pricing")}): the two plans and which tools each includes`,
    `- [${nav("help")}](${url("/help")}): a guide for every tool`,
  );

  for (const category of getCategories(LOCALE)) {
    lines.push("", `## ${category.name}`, "");
    for (const tool of category.tools) {
      lines.push(
        `- [${tool.name}](${url(`/help/${tool.id}`)}): ${tool.description} Plan: ${common(`planBadge.${tool.plan}`)}.`,
      );
    }
  }

  lines.push("", "## Guides", "");
  for (const guide of getGuides(LOCALE)) {
    lines.push(`- [${guide.title}](${url(`/help/${guide.slug}`)}): ${plainText(fill(guide.description))}`);
  }

  lines.push("", "## Comparisons", "");
  for (const item of comparisons.all(LOCALE)) {
    lines.push(`- [${fill(item.title)}](${url(`/compare/${item.slug}`)}): ${plainText(fill(item.description))}`);
  }

  lines.push("", "## Blog", "");
  for (const post of latestPosts(LOCALE)) {
    lines.push(`- [${fill(post.title)}](${url(`/blog/${post.slug}`)}): ${plainText(fill(post.description))}`);
  }

  lines.push(
    "",
    "## Optional",
    "",
    `- [Full help center](${absoluteUrl("/llms-full.txt")}): every tool guide and help article in one file`,
    `- [${footer("privacy")}](${url("/privacy")})`,
    `- [${footer("terms")}](${url("/terms")})`,
  );
  return `${lines.join("\n")}\n`;
}

async function toolText(tool: CatalogTool, fill: (text: string) => string): Promise<string> {
  const help = await getTranslations({ locale: LOCALE, namespace: "help" });
  const common = await getTranslations({ locale: LOCALE, namespace: "common" });
  const surface = await getTranslations({ locale: LOCALE, namespace: "surface" });
  const article = getToolArticle(LOCALE, tool.id);
  const lines = [
    `## ${tool.name}`,
    "",
    `${url(`/help/${tool.id}`)}`,
    "",
    fill(article?.intro ?? tool.description),
    "",
    `- ${help("plan")}: ${common(`planBadge.${tool.plan}`)}`,
    `- ${help("where")}: ${tool.surfaces.map((s) => surface(s)).join(", ")}`,
    "",
    `### ${help("steps")}`,
    "",
    toolSteps(tool, article, (key, values) => help(key, values))
      .map((step, index) => `${index + 1}. ${fill(step)}`)
      .join("\n"),
  ];
  if (article?.after?.length) {
    lines.push("", ...article.after.map((item) => `- ${fill(item)}`));
  }
  if (!tool.alwaysOn) {
    const settings = getSettings(LOCALE, tool.id, {
      on: common("on"),
      off: common("off"),
      empty: common("empty"),
      none: common("none"),
    });
    if (settings.length) lines.push("", `### ${help("settings")}`, "", ...settingLines(settings));
  }
  if (article?.tips?.length) {
    lines.push("", `### ${help("tips")}`, "", ...article.tips.map((tip) => `- ${fill(tip)}`));
  }
  if (article?.faq?.length) {
    lines.push(
      "",
      `### ${help("faq")}`,
      "",
      article.faq.map((item) => `Q: ${fill(item.q)}\nA: ${fill(item.a)}`).join("\n\n"),
    );
  }
  return lines.join("\n");
}

/** Everything in one file: the summary, every tool guide, the guides, comparisons and posts */
export async function llmsFullText(): Promise<string> {
  const fill = makeFill();
  const sections = [summary(fill).join("\n")];
  sections.push("# Tool guides");
  for (const category of getCategories(LOCALE)) {
    for (const tool of category.tools) sections.push(await toolText(tool, fill));
  }
  sections.push("# Help articles");
  for (const guide of getGuides(LOCALE)) {
    sections.push(
      [`## ${guide.title}`, "", url(`/help/${guide.slug}`), "", blocksText(guide.body, fill)].join("\n"),
    );
  }
  sections.push("# Comparisons");
  for (const item of comparisons.all(LOCALE)) {
    sections.push(
      [`## ${fill(item.title)}`, "", url(`/compare/${item.slug}`), "", blocksText(item.body, fill)].join("\n"),
    );
  }
  sections.push("# Blog");
  for (const post of latestPosts(LOCALE)) {
    sections.push(
      [`## ${fill(post.title)}`, "", url(`/blog/${post.slug}`), "", blocksText(post.body, fill)].join("\n"),
    );
  }
  return `${sections.join("\n\n")}\n`;
}
