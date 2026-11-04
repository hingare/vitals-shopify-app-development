import { en, type MessageKey } from "./locales/en";

/**
 * ভাষার রেজিস্ট্রি। এখন শুধু ইংরেজি।
 *
 * নতুন ভাষা যোগ করতে:
 * 1. `locales/en.ts` কপি করে `locales/<code>.ts` বানান (যেমন `bn.ts`, `hi.ts`, `ar.ts`) এবং লেখাগুলো অনুবাদ করুন।
 *    টাইপ `Partial<Record<MessageKey, string>>`, তাই কিছু লেখা বাদ থাকলেও চলবে (ইংরেজি দেখাবে)।
 * 2. নিচের `dictionaries`-এ এক লাইন যোগ করুন।
 * অ্যাডমিন আর উইজেট দুটোই Shopify-র locale দেখে স্বয়ংক্রিয়ভাবে সেই ভাষা বেছে নেবে।
 */
const dictionaries = {
  en,
} satisfies Record<string, Partial<Record<MessageKey, string>>>;

export type Locale = keyof typeof dictionaries;
export type { MessageKey };
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALES = Object.keys(dictionaries) as Locale[];

/** "bn-BD", "en-US" → সমর্থিত ভাষা; না মিললে ইংরেজি */
export function resolveLocale(input: string | null | undefined): Locale {
  const base = (input ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return base in dictionaries ? (base as Locale) : DEFAULT_LOCALE;
}

export function translate(
  locale: Locale,
  key: MessageKey | string,
  vars: Record<string, string | number> = {},
): string {
  const dict = dictionaries[locale] as Partial<Record<string, string>>;
  const template = dict[key] ?? (en as Record<string, string>)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function createT(locale: Locale) {
  return (key: MessageKey | string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
}
