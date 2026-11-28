/** স্টোরের টাইমজোনে তারিখের হিসাব (ডেলিভারি তারিখ ইত্যাদি) */

/** "+0600" → মিনিট */
export function offsetMinutes(tz = "+0000"): number {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(tz);
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}

/** স্টোরের ঘড়ির সময়, UTC getter দিয়ে পড়ার জন্য */
export function storeClock(now: number, tz?: string): Date {
  return new Date(now + offsetMinutes(tz) * 60_000);
}

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

function addDays(d: Date, days: number, skipWeekends: boolean): Date {
  const out = new Date(d.getTime());
  let left = days;
  while (skipWeekends && isWeekend(out)) out.setUTCDate(out.getUTCDate() + 1);
  while (left > 0) {
    out.setUTCDate(out.getUTCDate() + 1);
    if (!(skipWeekends && isWeekend(out))) left--;
  }
  return out;
}

export interface DeliveryWindow {
  start: Date;
  end: Date;
  /** আজকের কাটঅফ পর্যন্ত কত ms বাকি (আজ পাঠানো না গেলে null) */
  cutoffIn: number | null;
}

/**
 * আজ কাটঅফের আগে অর্ডার হলে আজ পাঠানো হয়, নইলে পরের কাজের দিনে।
 * তারপর min/max দিন যোগ (চাইলে শনি-রবি বাদ)। ফেরত তারিখ স্টোরের ঘড়িতে (UTC getter দিয়ে পড়ুন)।
 */
export function deliveryWindow(
  now: number,
  tz: string | undefined,
  s: { minDays: number; maxDays: number; skipWeekends: boolean; cutoffHour: number },
): DeliveryWindow {
  const clock = storeClock(now, tz);
  const cutoff = new Date(clock.getTime());
  cutoff.setUTCHours(s.cutoffHour, 0, 0, 0);
  const shipsToday = clock < cutoff && !(s.skipWeekends && isWeekend(clock));
  const ship = new Date(clock.getTime());
  if (!shipsToday) ship.setUTCDate(ship.getUTCDate() + 1);
  const min = Math.min(s.minDays, s.maxDays);
  const max = Math.max(s.minDays, s.maxDays);
  return {
    start: addDays(ship, min, s.skipWeekends),
    end: addDays(ship, max, s.skipWeekends),
    cutoffIn: shipsToday ? cutoff.getTime() - clock.getTime() : null,
  };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Mon, Dec 1"। ইংরেজি দোকানে Intl ছাড়াই (হুবহু একই লেখা, logic.test.ts মিলিয়ে দেখে): পাতায় প্রথমবার Intl চালু
 * হতে ফোনে কয়েক দশ ms লাগে, আর Shipping info-র লেখা early.ts পাতা আঁকার আগেই বানায়, যখন সেটা পাতা আঁকা পেছাত।
 */
export function formatDay(d: Date, locale: string): string {
  if (locale === "en")
    return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** 8100000 → "2h 15m" */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** "5 minutes ago" ক্রেতার ভাষায় */
export function timeAgo(iso: string, now: number, locale: string): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    for (const [unit, size] of units) {
      if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
    }
    return rtf.format(-1, "minute");
  } catch {
    return "";
  }
}
