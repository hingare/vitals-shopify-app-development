import { describe, expect, it } from "vitest";
import { joinDelay, splitDelay } from "./delay";

describe("delay", () => {
  it("shows the largest unit that fits exactly", () => {
    expect(splitDelay(5)).toEqual({ value: 5, unit: "minutes" });
    expect(splitDelay(90)).toEqual({ value: 90, unit: "minutes" });
    expect(splitDelay(120)).toEqual({ value: 2, unit: "hours" });
    expect(splitDelay(10_080)).toEqual({ value: 7, unit: "days" });
    expect(splitDelay(0)).toEqual({ value: 0, unit: "minutes" });
  });

  it("turns the form values back into minutes", () => {
    expect(joinDelay(7, "days")).toBe(10_080);
    expect(joinDelay(2, "hours")).toBe(120);
    expect(joinDelay(-3, "hours")).toBe(0);
    expect(joinDelay(Number.NaN, "days")).toBe(0);
    for (const minutes of [0, 5, 60, 90, 1440, 86_400]) {
      const { value, unit } = splitDelay(minutes);
      expect(joinDelay(value, unit)).toBe(minutes);
    }
  });
});
