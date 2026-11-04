import { z } from "zod";

/** প্ল্যান: শুধু দুটি পেইড প্ল্যান, কোনো usage fee নেই */
export const PLANS = ["starter", "professional"] as const;
export type Plan = (typeof PLANS)[number];

export const CATEGORIES = [
  "conversion",
  "trust",
  "upsell",
  "reviews",
  "marketing",
  "protect",
  "local",
  "ai",
  "platform",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** স্টোরের কোন পেজে টুল চলবে */
export type Surface = "all" | "home" | "product" | "collection" | "cart" | "checkout" | "thank-you";

/** টুল কীভাবে স্টোরে পৌঁছায় */
export type Delivery = "embed" | "block" | "function" | "checkout-extension" | "pixel" | "admin";

/** অ্যানালিটিক্সে কোন ইভেন্ট গোনা হবে */
export type AttributionEvent = "view" | "click" | "add_to_cart" | "purchase";

export interface ToolDefinition<S extends z.ZodType<Record<string, unknown>>> {
  /** kebab-case, যেমন "sticky-atc" */
  id: string;
  category: Category;
  plan: Plan;
  surfaces: Surface[];
  delivery: Delivery;
  settings: S;
  /** একসাথে চালু থাকলে সমস্যা হয় এমন টুল */
  conflictsWith?: string[];
  /** Shopify-র নিজস্ব বিকল্প থাকলে তার নাম (যেমন Currency Converter → "Shopify Markets") */
  shopifyNativeAlternative?: string | null;
  attribution?: AttributionEvent[];
  /** ডিফল্টে বন্ধ থাকবে কিনা (Shopify-বিকল্প টুলের জন্য true) */
  offByDefault?: boolean;
}

export type AnyTool = ToolDefinition<z.ZodType<Record<string, unknown>>>;

const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * নতুন টুল ঘোষণা করার একমাত্র উপায়।
 * সেটিংসের প্রতিটি ফিল্ডে ডিফল্ট থাকতে হবে, যাতে মার্চেন্ট টুল চালু করলেই এটা কাজ করে।
 */
export function defineTool<S extends z.ZodType<Record<string, unknown>>>(
  def: ToolDefinition<S>,
): ToolDefinition<S> {
  if (!ID_PATTERN.test(def.id)) {
    throw new Error(`Tool id "${def.id}" must be kebab-case`);
  }
  if (def.surfaces.length === 0) {
    throw new Error(`Tool "${def.id}" needs at least one surface`);
  }
  const parsed = def.settings.safeParse({});
  if (!parsed.success) {
    throw new Error(
      `Tool "${def.id}" settings must have a default for every field: ${parsed.error.message}`,
    );
  }
  return {
    conflictsWith: [],
    shopifyNativeAlternative: null,
    attribution: [],
    offByDefault: false,
    ...def,
  };
}

/** টুলের ডিফল্ট সেটিংস */
export function defaultSettings<S extends z.ZodType<Record<string, unknown>>>(
  tool: ToolDefinition<S>,
): z.output<S> {
  return tool.settings.parse({});
}

/** Starter-এর টুল Professional-এও চলে, উল্টোটা নয় */
export function canUseTool(tool: AnyTool, plan: Plan): boolean {
  return plan === "professional" || tool.plan === "starter";
}

/** থিমের রং: প্রতিটি টুলে একই রকম রঙের সেটিং */
export function themeColors() {
  const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
  return z
    .object({
      background: hex.default("#FFFFFF"),
      text: hex.default("#111827"),
      accent: hex.default("#4F46E5"),
    })
    .default({ background: "#FFFFFF", text: "#111827", accent: "#4F46E5" });
}

export interface Registry {
  all: AnyTool[];
  get(id: string): AnyTool | undefined;
  /** চালু টুলগুলোর মধ্যে কনফ্লিক্ট থাকলে তার জোড়া ফেরত দেয় */
  conflicts(enabledIds: string[]): Array<[string, string]>;
}

export function createRegistry(tools: AnyTool[]): Registry {
  const byId = new Map<string, AnyTool>();
  for (const tool of tools) {
    if (byId.has(tool.id)) throw new Error(`Duplicate tool id "${tool.id}"`);
    byId.set(tool.id, tool);
  }
  for (const tool of tools) {
    for (const other of tool.conflictsWith ?? []) {
      if (!byId.has(other)) {
        throw new Error(`Tool "${tool.id}" conflicts with unknown tool "${other}"`);
      }
    }
  }
  return {
    all: tools,
    get: (id) => byId.get(id),
    conflicts(enabledIds) {
      const enabled = new Set(enabledIds);
      const seen = new Set<string>();
      const pairs: Array<[string, string]> = [];
      for (const id of enabledIds) {
        for (const other of byId.get(id)?.conflictsWith ?? []) {
          if (!enabled.has(other)) continue;
          const pair = [id, other].sort() as [string, string];
          const key = pair.join("|");
          if (!seen.has(key)) {
            seen.add(key);
            pairs.push(pair);
          }
        }
      }
      return pairs;
    },
  };
}

export { z };
