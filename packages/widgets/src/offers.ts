import type { OfferRules, StoreConfig } from "./types";
import { storeClock } from "./dates";
import { store } from "./dom";

const AB_KEY = "app_ab";
const AB_ATTRIBUTE = "_app_ab";

/** ক্রেতার A/B গ্রুপ: প্রথমবার এলোমেলোভাবে A বা B, তারপর একই থাকে */
export function abGroup(): "A" | "B" {
  const saved = store.get(AB_KEY);
  if (saved === "A" || saved === "B") return saved;
  const group = Math.random() < 0.5 ? "A" : "B";
  store.set(AB_KEY, group);
  return group;
}

let synced = false;

/**
 * A/B টেস্ট চললে গ্রুপটা cart attribute-এ রাখি, যাতে চেকআউটের ছাড়ও একই গ্রুপ মেনে চলে
 * আর অর্ডারের রিপোর্টে গ্রুপ গোনা যায়। প্রতি পেজে একবারই পাঠাই।
 */
export function syncAbGroup(config: StoreConfig) {
  if (!config.offers?.ab || synced) return;
  synced = true;
  const group = abGroup();
  try {
    if (sessionStorage.getItem(AB_KEY) === group) return;
    sessionStorage.setItem(AB_KEY, group);
  } catch {
    // private mode: প্রতিবার পাঠাই
  }
  void fetch("/cart/update.js", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attributes: { [AB_ATTRIBUTE]: group } }),
  }).catch(() => undefined);
}

/** স্টোরের আজকের তারিখ YYYY-MM-DD */
export function storeToday(config: StoreConfig, now = Date.now()): string {
  return storeClock(now, config.tzOffset).toISOString().slice(0, 10);
}

/** তারিখ আর A/B গ্রুপ মিলিয়ে অফারটা এই ক্রেতাকে দেখানো যায় কিনা */
export function offerShown(rules: OfferRules | undefined, config: StoreConfig, now = Date.now()) {
  if (!rules) return true;
  const today = storeToday(config, now);
  if (rules.startsOn && today < rules.startsOn) return false;
  if (rules.endsOn && today > rules.endsOn) return false;
  if (rules.abGroup && rules.abGroup !== abGroup()) return false;
  return true;
}
