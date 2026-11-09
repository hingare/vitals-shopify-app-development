import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRates, getRates } from "./fx.server";

const ok = (rates: Record<string, number>) => ({
  ok: true,
  json: async () => ({ result: "success", rates }),
});

describe("getRates", () => {
  beforeEach(() => clearRates());

  it("keeps only supported currencies and caches for 12 hours", async () => {
    const fetcher = vi.fn(async () => ok({ USD: 1, EUR: 0.9, XYZ: 5 }));
    expect(await getRates("USD", 0, fetcher)).toEqual({ USD: 1, EUR: 0.9 });
    await getRates("USD", 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await getRates("USD", 13 * 3600_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects bad currency codes and keeps old rates when the source fails", async () => {
    expect(await getRates("usd", 0, vi.fn())).toBeNull();
    await getRates("GBP", 0, async () => ok({ EUR: 1.1 }));
    const failing = async () => ({ ok: false, json: async () => ({}) });
    expect(await getRates("GBP", 13 * 3600_000, failing)).toEqual({ EUR: 1.1 });
  });
});
