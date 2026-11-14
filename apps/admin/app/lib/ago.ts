import type { TFunction } from "@app/i18n";

/** কত মিনিট আগে (ভবিষ্যৎ হলে ০) */
export const minutesSince = (date: Date | string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - new Date(date).getTime()) / 60_000));

/** "এইমাত্র", "৫ মিনিট আগে", "৩ ঘণ্টা আগে", "২ দিন আগে" */
export function ago(t: TFunction, minutes: number) {
  if (minutes < 1) return t("time.ago.now");
  if (minutes < 60) return t("time.ago.minutes", { n: minutes });
  if (minutes < 1440) return t("time.ago.hours", { n: Math.floor(minutes / 60) });
  return t("time.ago.days", { n: Math.floor(minutes / 1440) });
}
