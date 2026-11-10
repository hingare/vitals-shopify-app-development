/** দেরি মিনিটে রাখা হয়; ফর্মে সংখ্যা আর একক আলাদা দেখানো হয় (যাতে অনুবাদ সহজ হয়) */
export const DELAY_UNITS = { minutes: 1, hours: 60, days: 1440 } as const;
export type DelayUnit = keyof typeof DELAY_UNITS;

/** ৯০ → 90 minutes, ১২০ → 2 hours, ১৪৪০ → 1 day */
export function splitDelay(minutes: number): { value: number; unit: DelayUnit } {
  if (minutes > 0 && minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes > 0 && minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

export const joinDelay = (value: number, unit: DelayUnit) =>
  Math.max(0, Math.round(value) || 0) * DELAY_UNITS[unit];
