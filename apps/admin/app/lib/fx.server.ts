import { CURRENCIES } from "@app/tools";

/**
 * Currency Converter-এর বিনিময় হার।
 * ExchangeRate-API-র ফ্রি হার (দিনে একবার বদলায়) সার্ভারে ১২ ঘণ্টা রাখা হয়, তাই প্রতি পেজে বাইরে কল যায় না।
 */
const TTL = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; rates: Record<string, number> }>();

export type Fetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function getRates(
  base: string,
  now = Date.now(),
  fetcher: Fetcher = (url) => fetch(url),
): Promise<Record<string, number> | null> {
  if (!/^[A-Z]{3}$/.test(base)) return null;
  const hit = cache.get(base);
  if (hit && now - hit.at < TTL) return hit.rates;
  try {
    const res = await fetcher(`https://open.er-api.com/v6/latest/${base}`);
    if (!res.ok) return hit?.rates ?? null;
    const json = (await res.json()) as { result?: string; rates?: Record<string, unknown> };
    if (json.result !== "success" || !json.rates) return hit?.rates ?? null;
    const rates: Record<string, number> = {};
    for (const code of CURRENCIES) {
      const rate = json.rates[code];
      if (typeof rate === "number" && rate > 0) rates[code] = rate;
    }
    cache.set(base, { at: now, rates });
    return rates;
  } catch {
    return hit?.rates ?? null;
  }
}

export function clearRates() {
  cache.clear();
}
