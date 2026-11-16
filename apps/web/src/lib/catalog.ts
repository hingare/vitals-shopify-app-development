import { createT, resolveLocale } from "@app/i18n";
import { registry } from "@app/tools";
import {
  CATEGORIES,
  defaultSettings,
  z,
  type AnyTool,
  type Category,
  type Delivery,
  type Plan,
  type Surface,
} from "@app/tool-sdk";

/**
 * Everything the website says about a tool comes from the same registry and the same texts as the
 * app, so a renamed tool, a new setting or a plan change shows up here without editing the site.
 */
export interface CatalogTool {
  id: string;
  name: string;
  description: string;
  category: Category;
  plan: Plan;
  surfaces: Surface[];
  delivery: Delivery;
  /** Opened from the app (AI Studio) instead of switched on */
  alwaysOn: boolean;
  offByDefault: boolean;
  nativeAlternative: string | null;
  conflictsWith: string[];
}

export interface CategoryGroup {
  id: Category;
  name: string;
  tools: CatalogTool[];
}

function textsFor(locale: string) {
  return createT(resolveLocale(locale));
}

function toCatalogTool(tool: AnyTool, t: ReturnType<typeof textsFor>): CatalogTool {
  return {
    id: tool.id,
    name: t(`tool.${tool.id}.name`),
    description: t(`tool.${tool.id}.description`),
    category: tool.category,
    plan: tool.plan,
    surfaces: [...tool.surfaces],
    delivery: tool.delivery,
    alwaysOn: tool.alwaysOn === true,
    offByDefault: tool.offByDefault === true,
    nativeAlternative: tool.shopifyNativeAlternative ?? null,
    conflictsWith: [...(tool.conflictsWith ?? [])],
  };
}

export function getCatalog(locale: string): CatalogTool[] {
  const t = textsFor(locale);
  return registry.all.map((tool) => toCatalogTool(tool, t));
}

export function getTool(locale: string, id: string): CatalogTool | undefined {
  const tool = registry.get(id);
  return tool ? toCatalogTool(tool, textsFor(locale)) : undefined;
}

export const toolIds = (): string[] => registry.all.map((tool) => tool.id);

export function categoryName(locale: string, id: Category): string {
  return textsFor(locale)(`category.${id}`);
}

/** Categories in the app's order, leaving out empty ones */
export function getCategories(locale: string): CategoryGroup[] {
  const tools = getCatalog(locale);
  return CATEGORIES.map((id) => ({
    id,
    name: categoryName(locale, id),
    tools: tools.filter((tool) => tool.category === id),
  })).filter((group) => group.tools.length > 0);
}

export function planCounts(): Record<Plan, number> {
  const all = registry.all.length;
  const starter = registry.all.filter((tool) => tool.plan === "starter").length;
  return { starter, professional: all };
}

/* ------------------------------------------------------------------ */
/* Settings, as the merchant sees them in the app                       */
/* ------------------------------------------------------------------ */

interface JsonSchema {
  type?: string;
  enum?: string[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
}

export type SettingKind = "toggle" | "choice" | "multi" | "color" | "date" | "number" | "text" | "group";

export interface SettingRow {
  key: string;
  label: string;
  help: string | null;
  kind: SettingKind;
  /** The value a new store starts with, written the way the app shows it */
  defaultText: string;
  /** For choices: the options in the app's words */
  options: string[];
  min?: number;
  max?: number;
  children: SettingRow[];
}

const HEX = /^\^#\[0-9a-fA-F\]\{6\}\$$/;
const DATE = "^$|^\\d{4}-\\d{2}-\\d{2}$";

function describe(
  key: string,
  schema: JsonSchema,
  value: unknown,
  t: ReturnType<typeof textsFor>,
  words: SettingWords,
): SettingRow {
  const label = t(`field.${key}`);
  const helpKey = `help.${key}`;
  const helpText = t(helpKey);
  const help = helpText === helpKey ? null : helpText;
  const base = { key, label, help, options: [] as string[], children: [] as SettingRow[] };

  if (schema.type === "object" && schema.properties) {
    const values = (value ?? {}) as Record<string, unknown>;
    return {
      ...base,
      kind: "group",
      defaultText: "",
      children: Object.entries(schema.properties).map(([childKey, child]) =>
        describe(childKey, child, values[childKey], t, words),
      ),
    };
  }
  if (schema.type === "array" && schema.items?.enum) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return {
      ...base,
      kind: "multi",
      options: schema.items.enum.map((option) => t(`option.${option}`)),
      defaultText: selected.length
        ? selected.map((option) => t(`option.${option}`)).join(", ")
        : words.none,
    };
  }
  if (schema.enum) {
    return {
      ...base,
      kind: "choice",
      options: schema.enum.map((option) => t(`option.${option}`)),
      defaultText: t(`option.${String(value)}`),
    };
  }
  if (schema.type === "boolean") {
    return { ...base, kind: "toggle", defaultText: value === true ? words.on : words.off };
  }
  if (schema.type === "string" && schema.pattern && HEX.test(schema.pattern)) {
    return { ...base, kind: "color", defaultText: String(value ?? "") };
  }
  if (schema.type === "string" && schema.pattern === DATE) {
    return { ...base, kind: "date", defaultText: value ? String(value) : words.empty };
  }
  if (schema.type === "number" || schema.type === "integer") {
    return {
      ...base,
      kind: "number",
      defaultText: String(value ?? ""),
      ...(schema.minimum !== undefined ? { min: schema.minimum } : {}),
      ...(schema.maximum !== undefined ? { max: schema.maximum } : {}),
    };
  }
  const text = typeof value === "string" ? value : "";
  return { ...base, kind: "text", defaultText: text === "" ? words.empty : text };
}

export interface SettingWords {
  on: string;
  off: string;
  empty: string;
  none: string;
}

/** The settings form of a tool, row by row, with the labels and defaults the app uses */
export function getSettings(locale: string, id: string, words: SettingWords): SettingRow[] {
  const tool = registry.get(id);
  if (!tool) return [];
  const t = textsFor(locale);
  const schema = z.toJSONSchema(tool.settings, { io: "input" }) as JsonSchema;
  const defaults = defaultSettings(tool) as Record<string, unknown>;
  return Object.entries(schema.properties ?? {}).map(([key, field]) =>
    describe(key, field, defaults[key], t, words),
  );
}
