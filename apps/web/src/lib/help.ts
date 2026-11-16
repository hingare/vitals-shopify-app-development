import type { ToolArticle } from "@/content/help/types";
import type { CatalogTool } from "./catalog";

/** Tools that show something in the store need the app embed switched on first */
export const NEEDS_EMBED: ReadonlySet<string> = new Set(["embed", "block", "function"]);

type StepText = (
  key: "stepOpen" | "stepSave" | "stepOpenStudio",
  values?: { name: string },
) => string;

/**
 * The setup steps of a tool's help article: opening the tool, the article's own steps, then saving.
 * AI Studio tools have no switch, so they open from AI Studio and have nothing to save.
 */
export function toolSteps(tool: CatalogTool, article: ToolArticle | null, t: StepText): string[] {
  const setup = article?.setup ?? [];
  return tool.alwaysOn
    ? [t("stepOpenStudio", { name: tool.name }), ...setup]
    : [t("stepOpen", { name: tool.name }), ...setup, t("stepSave")];
}
