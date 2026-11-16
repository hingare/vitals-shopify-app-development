import { brand } from "@app/brand";
import { describe, expect, it, vi } from "vitest";
import { guideSlugs } from "@/content/help";
import { getCatalog } from "./catalog";
import { llmsFullText, llmsText } from "./llms";
import { absoluteUrl } from "./site";

// Outside Next.js there's no request config, so translations come straight from the messages file
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../messages/en.json")).default;
  return {
    getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
      createTranslator({ locale, messages, namespace: namespace as never }),
  };
});

describe("llms.txt", () => {
  it("names the app and links every tool guide and help article", async () => {
    const text = await llmsText();
    expect(text.startsWith(`# ${brand.name}\n`)).toBe(true);
    for (const tool of getCatalog("en")) expect(text).toContain(absoluteUrl(`/help/${tool.id}`));
    for (const slug of guideSlugs()) expect(text).toContain(absoluteUrl(`/help/${slug}`));
    expect(text).toContain(absoluteUrl("/llms-full.txt"));
  });

  it("has every plan fact filled in", async () => {
    expect(await llmsText()).not.toMatch(/\{(brand|starterPrice|proPrice|proTools|trialDays)\}/);
  });
});

describe("llms-full.txt", () => {
  it("has a section for every tool, with full links only", async () => {
    const text = await llmsFullText();
    for (const tool of getCatalog("en")) expect(text).toContain(`\n## ${tool.name}\n`);
    expect(text).not.toContain("](/");
    expect(text).not.toMatch(/\{(brand|starterPrice|proPrice|proTools|trialDays|emails)\}/);
  });
});
