import { describe, expect, it } from "vitest";
import { canUseTool, createRegistry, defaultSettings, defineTool, themeColors, z } from "./index";

const stickyAtc = defineTool({
  id: "sticky-atc",
  category: "conversion",
  plan: "starter",
  surfaces: ["product"],
  delivery: "embed",
  settings: z.object({
    position: z.enum(["bottom", "top"]).default("bottom"),
    showOnMobile: z.boolean().default(true),
    colors: themeColors(),
  }),
  attribution: ["click", "add_to_cart"],
});

const recordings = defineTool({
  id: "visitor-recordings",
  category: "marketing",
  plan: "professional",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({ monthlyCap: z.number().int().positive().default(1000) }),
});

describe("defineTool", () => {
  it("fills defaults so a tool works as soon as it is switched on", () => {
    expect(defaultSettings(stickyAtc)).toEqual({
      position: "bottom",
      showOnMobile: true,
      colors: { background: "#FFFFFF", text: "#111827", accent: "#4F46E5" },
    });
  });

  it("rejects ids that are not kebab-case", () => {
    expect(() => defineTool({ ...stickyAtc, id: "StickyATC" })).toThrow(/kebab-case/);
  });

  it("allows the always-on switchless mode only for admin tools", () => {
    expect(() => defineTool({ ...stickyAtc, id: "on-store", alwaysOn: true })).toThrow(/admin/);
    const writer = defineTool({
      ...stickyAtc,
      id: "ai-writer",
      delivery: "admin",
      alwaysOn: true,
      settings: z.object({}),
    });
    expect(writer.alwaysOn).toBe(true);
    expect(stickyAtc.alwaysOn).toBe(false);
  });

  it("rejects settings without defaults", () => {
    expect(() =>
      defineTool({ ...stickyAtc, id: "bad-tool", settings: z.object({ title: z.string() }) }),
    ).toThrow(/default/);
  });
});

describe("canUseTool", () => {
  it("allows starter tools on both plans and professional tools only on professional", () => {
    expect(canUseTool(stickyAtc, "starter")).toBe(true);
    expect(canUseTool(stickyAtc, "professional")).toBe(true);
    expect(canUseTool(recordings, "starter")).toBe(false);
    expect(canUseTool(recordings, "professional")).toBe(true);
  });
});

describe("createRegistry", () => {
  it("finds conflicts between enabled tools once per pair", () => {
    const drawer = defineTool({ ...stickyAtc, id: "cart-drawer", conflictsWith: ["sticky-atc"] });
    const registry = createRegistry([stickyAtc, drawer, recordings]);
    expect(registry.conflicts(["sticky-atc", "cart-drawer"])).toEqual([
      ["cart-drawer", "sticky-atc"],
    ]);
    expect(registry.conflicts(["sticky-atc", "visitor-recordings"])).toEqual([]);
  });

  it("rejects duplicate ids", () => {
    expect(() => createRegistry([stickyAtc, stickyAtc])).toThrow(/Duplicate/);
  });
});
