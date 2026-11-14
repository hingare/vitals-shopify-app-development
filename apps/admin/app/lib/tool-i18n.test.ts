import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translate } from "@app/i18n";
import { z } from "@app/tool-sdk";
import { registry } from "@app/tools";
import type { JsonSchema } from "../components/SettingsForm";
import { TOOL_PAGES } from "./tool-pages";

/** প্রতিটি টুল, ফিল্ড আর অপশনের ইংরেজি লেখা আছে কিনা (না থাকলে অ্যাডমিনে key দেখা যেত) */
function missingKeys(): string[] {
  const keys = new Set<string>();
  const walk = (schema: JsonSchema) => {
    for (const [name, field] of Object.entries(schema.properties ?? {})) {
      keys.add(`field.${name}`);
      for (const option of field.enum ?? field.items?.enum ?? []) keys.add(`option.${option}`);
      if (field.properties) walk(field);
    }
  };
  for (const tool of registry.all) {
    keys.add(`tool.${tool.id}.name`);
    keys.add(`tool.${tool.id}.description`);
    walk(z.toJSONSchema(tool.settings, { io: "input" }) as JsonSchema);
  }
  return [...keys].filter((key) => translate("en", key) === key);
}

describe("tool translations", () => {
  it("has English text for every tool, field and option", () => {
    expect(missingKeys()).toEqual([]);
  });
});

describe("tool pages", () => {
  /** "/app/marketing/push" -> app.marketing.push.tsx, বা ফোল্ডারের প্রথম পেজ হলে app.marketing._index.tsx */
  const routes = join(__dirname, "../routes");
  const routeExists = (path: string) => {
    const parts = path.slice(1).split("/");
    const base = join(routes, parts.join("."));
    if (existsSync(`${base}.tsx`) || existsSync(`${base}._index.tsx`)) return true;
    // শেষ অংশ বদলায় এমন পেজ: "/app/ai/ai-product-faq" -> app.ai.$toolId.tsx
    const parent = parts.slice(0, -1).join(".");
    return readdirSync(routes).some(
      (file) => file.startsWith(`${parent}.$`) && file.split(".").length === parts.length + 1,
    );
  };

  it("links only real tools to pages that exist, each with a button label", () => {
    for (const [toolId, path] of Object.entries(TOOL_PAGES)) {
      expect(registry.get(toolId), toolId).toBeTruthy();
      expect(routeExists(path), path).toBe(true);
      expect(translate("en", `tools.page.${toolId}`), toolId).not.toBe(`tools.page.${toolId}`);
    }
  });
});
