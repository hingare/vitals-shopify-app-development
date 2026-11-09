/** দামের লেখা থেকে সংখ্যা বের করা, স্টোরের money_format অনুযায়ী */
export function separators(moneyFormat = ""): { thousands: string; decimal: string } {
  if (/amount_with_comma_separator|amount_no_decimals_with_comma_separator/.test(moneyFormat)) {
    return { thousands: ".", decimal: "," };
  }
  if (/amount_with_apostrophe_separator/.test(moneyFormat)) return { thousands: "'", decimal: "." };
  if (/amount_with_space_separator/.test(moneyFormat)) return { thousands: " ", decimal: "," };
  return { thousands: ",", decimal: "." };
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
