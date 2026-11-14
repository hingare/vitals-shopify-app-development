import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { translate } from "@app/i18n";
import { registry } from "@app/tools";

vi.mock("../../db.server", () => ({ default: {} }));
const { AI_ERROR_CODES } = await import("./errors");
const { GENERATION_STATUSES } = await import("./generations.server");
const { AI_TOOL_GROUPS } = await import("./studio.server");
const { EXPAND_SHAPES, MOTION_IDS, SCENE_IDS, SHOT_SHAPES } = await import("./media/models");
const { AD_CTAS } = await import("./media/output");

const missing = (keys: string[]) => keys.filter((key) => translate("en", key) === key);

/** AI পেজের লেখাগুলো আছে কিনা (না থাকলে অ্যাডমিনে key দেখা যেত) */
describe("AI page translations", () => {
  it("has English text for every error, status, group and tool", () => {
    const keys = [
      ...AI_ERROR_CODES.map((code) => `ai.error.${code}`),
      ...GENERATION_STATUSES.map((status) => `ai.status.${status}`),
      ...Object.keys(AI_TOOL_GROUPS).map((group) => `ai.group.${group}`),
      ...Object.values(AI_TOOL_GROUPS)
        .flat()
        .flatMap((id) => [`tool.${id}.name`, `tool.${id}.description`]),
    ];
    expect(missing(keys)).toEqual([]);
  });

  it("names every choice of the photo and video tools", () => {
    const options = [
      ...EXPAND_SHAPES,
      ...MOTION_IDS,
      ...SCENE_IDS,
      ...SHOT_SHAPES,
      ...AD_CTAS,
      "custom",
      "transparent",
      "white",
      "upscale",
      "expand",
    ];
    expect(missing(options.map((option) => `ai.option.${option}`))).toEqual([]);
  });

  it("has every fixed text the AI pages ask for", () => {
    const files = [
      "../../components/ai/AiForms.tsx",
      "../../components/ai/FormParts.tsx",
      "../../components/ai/MediaForms.tsx",
      "../../components/ai/AiResults.tsx",
      "../../components/ai/CreditsSummary.tsx",
      "../../components/CopyButton.tsx",
      "../../routes/app.ai.$toolId.tsx",
    ];
    const keys = new Set<string>();
    for (const file of files) {
      const source = readFileSync(join(__dirname, file), "utf8");
      // t("...") আর এক জায়গায় রাখা চাবি ("ai.results.applyMedia" এর মতো)
      for (const match of source.matchAll(/["'`]((?:ai|tool|nav|tools)\.[\w.:-]+)["'`]/g)) {
        keys.add(match[1]!);
      }
    }
    expect(keys.size).toBeGreaterThan(50);
    expect(missing([...keys])).toEqual([]);
  });

  it("gives every always-on AI tool a page in the AI Studio", () => {
    const studio = new Set<string>(Object.values(AI_TOOL_GROUPS).flat());
    const alwaysOn = registry.all.filter((tool) => tool.alwaysOn).map((tool) => tool.id);
    expect(alwaysOn.length).toBeGreaterThan(0);
    expect(alwaysOn.filter((id) => !studio.has(id))).toEqual([]);
  });
});
