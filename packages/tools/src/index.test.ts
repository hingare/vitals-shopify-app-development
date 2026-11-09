import { describe, expect, it } from "vitest";
import { buildStoreConfig, registry } from "./index";

describe("tool catalog", () => {
  it("every tool has valid defaults", () => {
    for (const tool of registry.all) {
      expect(() => tool.settings.parse({})).not.toThrow();
    }
  });
});

describe("buildStoreConfig", () => {
  it("sends nothing when the shop has no plan", () => {
    expect(
      buildStoreConfig(registry, [{ toolId: "sticky-atc", enabled: true, settings: {} }], null),
    ).toEqual({
      tools: [],
    });
  });

  it("includes enabled tools with defaults filled and skips disabled or unknown ones", () => {
    const config = buildStoreConfig(
      registry,
      [
        { toolId: "sticky-atc", enabled: true, settings: { position: "top" } },
        { toolId: "unknown-tool", enabled: true, settings: {} },
      ],
      "starter",
    );
    expect(config.tools).toHaveLength(1);
    expect(config.tools[0]).toMatchObject({
      id: "sticky-atc",
      settings: { position: "top", showOnMobile: true },
    });
  });

  it("falls back to defaults when saved settings are invalid", () => {
    const config = buildStoreConfig(
      registry,
      [{ toolId: "sticky-atc", enabled: true, settings: { position: "middle" } }],
      "starter",
    );
    expect(config.tools[0]?.settings.position).toBe("bottom");
  });
});
