/**
 * সাধারণ in-memory রেট লিমিট (এক সার্ভার প্রসেসের জন্য)।
 * একাধিক সার্ভার হলে Redis-এ সরাতে হবে; তখনও এই ফাংশনের ইন্টারফেস একই থাকবে।
 */
const buckets = new Map<string, number[]>();
const MAX_KEYS = 10_000;

export function allowRequest(key: string, limit: number, windowMs: number, now = Date.now()) {
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.delete(key);
  buckets.set(key, recent);
  if (buckets.size > MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }
  return true;
}

export function resetRateLimits() {
  buckets.clear();
}
