import { afterEach, describe, expect, it, vi } from "vitest";
import { track } from "./analytics";

describe("widget analytics", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends at most 50 events at a time, as many as the server takes", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    vi.stubGlobal("navigator", {
      sendBeacon: (_url: string, body: string) => sent.push(body) > 0,
    });
    for (let i = 0; i < 51; i++) track("sticky-add-to-cart", "view");
    expect(sent).toHaveLength(1);
    expect((JSON.parse(sent[0] as string) as { events: unknown[] }).events).toHaveLength(50);
    vi.advanceTimersByTime(3000);
    expect(sent).toHaveLength(2);
    expect((JSON.parse(sent[1] as string) as { events: unknown[] }).events).toHaveLength(1);
  });
});
