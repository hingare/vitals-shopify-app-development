/** দামের লেখা থেকে সংখ্যা বের করা, স্টোরের money_format অনুযায়ী */
export function separators(moneyFormat = ""): { thousands: string; decimal: string } {
  if (/amount_with_comma_separator|amount_no_decimals_with_comma_separator/.test(moneyFormat)) {
    return { thousands: ".", decimal: "," };
  }
  if (/amount_with_apostrophe_separator/.test(moneyFormat)) return { thousands: "'", decimal: "." };
  if (/amount_with_space_separator/.test(moneyFormat)) return { thousands: " ", decimal: "," };
  return { thousands: ",", decimal: "." };
}

/** money_format-এর {{...}} জায়গা → [দশমিকের ঘর, হাজারের চিহ্ন, দশমিক চিহ্ন] (Shopify-র তালিকা) */
const AMOUNTS: Record<string, [number, string, string]> = {
  amount: [2, ",", "."],
  amount_no_decimals: [0, ",", "."],
  amount_with_comma_separator: [2, ".", ","],
  amount_no_decimals_with_comma_separator: [0, ".", ","],
  amount_with_apostrophe_separator: [2, "'", "."],
  amount_no_decimals_with_space_separator: [0, " ", "."],
  amount_with_space_separator: [2, " ", ","],
  amount_with_period_and_space_separator: [2, " ", "."],
};

/**
 * থিম যেভাবে দাম লেখে, স্টোরের money_format দিয়ে: 125000, "Tk {{amount}}" → "Tk 1,250.00"।
 * format-এ চেনা জায়গা না থাকলে null (তখন Intl)।
 */
export function formatShopMoney(cents: number, moneyFormat: string): string | null {
  const match = /\{\{\s*(\w+)\s*\}\}/.exec(moneyFormat);
  const spec = match ? AMOUNTS[match[1]!] : undefined;
  if (!match || !spec) return null;
  // ছাড়ের মতো ঋণাত্মক দাম: চিহ্নের আগে "-" (Intl আর Shopify-র money ফিল্টারের মতো)
  if (cents < 0) return `-${formatShopMoney(-cents, moneyFormat)}`;
  const [decimals, thousands, decimal] = spec;
  const [whole = "0", fraction] = (cents / 100).toFixed(decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return moneyFormat.replace(match[0], fraction ? `${grouped}${decimal}${fraction}` : grouped);
}

/** "$1,234.50" → 1234.5 ; দাম না থাকলে null */
export function parseMoney(text: string, moneyFormat?: string): number | null {
  const match = /\d[\d.,'\s ]*/.exec(text);
  if (!match) return null;
  const { thousands, decimal } = separators(moneyFormat);
  let raw = match[0].replace(/[\s\u00a0]/g, "");
  if (thousands !== " ") raw = raw.split(thousands).join("");
  raw = raw.replace(decimal, ".");
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

const EURO = "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" ");
const BY_REGION: Record<string, string> = {
  US: "USD",
  GB: "GBP",
  CA: "CAD",
  AU: "AUD",
  IN: "INR",
  BD: "BDT",
  PK: "PKR",
  AE: "AED",
  SA: "SAR",
  JP: "JPY",
  CN: "CNY",
  SG: "SGD",
  MY: "MYR",
  NZ: "NZD",
  CH: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  ZA: "ZAR",
};

/** ব্রাউজারের ভাষা "en-GB" → "GBP" */
export function currencyForLocale(locale: string): string | null {
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  if (!region) return null;
  return EURO.includes(region) ? "EUR" : (BY_REGION[region] ?? null);
}

/**
 * লেখার শুধু দামের অংশটা বদলায়: "Total: $20.00 USD" → "Total: £16.00"
 * (মুদ্রার চিহ্ন আগে বা কোড পরে থাকলে সেটাও সরে)
 */
export function replaceMoney(text: string, formatted: string): string {
  const match = /\d[\d.,'\s ]*\d|\d/.exec(text);
  if (!match) return text;
  let start = match.index;
  let end = start + match[0].length;
  const before = /(?:[A-Z]{3}\s?|Tk\.?\s?|Rs\.?\s?|[^\w\s]{1,3}\s?)$/.exec(text.slice(0, start));
  if (before) start -= before[0].length;
  const after = /^\s?[A-Z]{3}\b/.exec(text.slice(end));
  if (after) end += after[0].length;
  return text.slice(0, start) + formatted + text.slice(end);
}
