import { describe, expect, it, vi } from "vitest";
import { translate } from "@app/i18n";
import { registry } from "@app/tools";

vi.mock("../../db.server", () => ({ default: {} }));
const { AI_ERROR_CODES } = await import("./errors");
const { GENERATION_STATUSES } = await import("./generations.server");
const { AI_TOOL_GROUPS } = await import("./studio.server");

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
    expect(keys.filter((key) => translate("en", key) === key)).toEqual([]);
  });

  it("gives every always-on AI tool a page in the AI Studio", () => {
    const studio = new Set<string>(Object.values(AI_TOOL_GROUPS).flat());
    const alwaysOn = registry.all.filter((tool) => tool.alwaysOn).map((tool) => tool.id);
    expect(alwaysOn.length).toBeGreaterThan(0);
    expect(alwaysOn.filter((id) => !studio.has(id))).toEqual([]);
  });
});
