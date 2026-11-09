import { describe, expect, it } from "vitest";
import { translate } from "@app/i18n";
import { z } from "@app/tool-sdk";
import { registry } from "@app/tools";
import type { JsonSchema } from "../components/SettingsForm";

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
