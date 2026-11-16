import { describe, expect, it } from "vitest";
import { DailyLimiter, WindowLimiter } from "./rate-limit";

describe("WindowLimiter", () => {
  it("allows the limit in a window, then refuses until the window ends", () => {
    const limiter = new WindowLimiter(2, 1000);
    expect(limiter.take("a", 0)).toBe(true);
    expect(limiter.take("a", 10)).toBe(true);
    expect(limiter.take("a", 20)).toBe(false);
    expect(limiter.take("b", 20)).toBe(true);
    expect(limiter.take("a", 1000)).toBe(true);
  });

  it("never holds more keys than its maximum", () => {
    const limiter = new WindowLimiter(1, 1000, 3);
    for (const key of ["a", "b", "c", "d", "e"]) expect(limiter.take(key, 0)).toBe(true);
    expect(limiter.take("e", 1)).toBe(false);
  });
});

describe("DailyLimiter", () => {
  it("counts per UTC day", () => {
    const limiter = new DailyLimiter(2);
    const day = new Date("2026-11-16T10:00:00Z");
    expect(limiter.take(day)).toBe(true);
    expect(limiter.take(day)).toBe(true);
    expect(limiter.take(day)).toBe(false);
    expect(limiter.take(new Date("2026-11-17T00:00:00Z"))).toBe(true);
  });
});
