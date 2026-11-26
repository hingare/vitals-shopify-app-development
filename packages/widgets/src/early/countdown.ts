import { earlyT } from "../i18n-early";
import { h } from "./h";

/** কাউন্টডাউনের বাক্স: পাতা আঁকার আগে early.ts বানায়, টুলের ফাইল প্রতি সেকেন্ডে সংখ্যা বদলায় */

export interface CountdownSettings {
  endDate: string;
  endTime: string;
  message: string;
  colors: { background: string; text: string; accent: string };
}

/** "2026-11-30" + "23:59" + "+0600" → সেই মুহূর্ত (ms); ভুল হলে NaN */
export function endsAt(date: string, time: string, tz = "+0000"): number {
  const offset = /^[+-]\d{4}$/.test(tz) ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "Z";
  return Date.parse(`${date}T${time}:00${offset}`);
}

const UNITS = ["days", "hours", "minutes", "seconds"] as const;

export function buildCountdown(s: CountdownSettings, locale: string): HTMLElement {
  return h(
    "div",
    `margin:16px 0;padding:12px;border-radius:8px;background:${s.colors.background};color:${s.colors.text};text-align:center`,
    {},
    ...(s.message ? [h("p", "margin:0 0 8px;font-weight:600", {}, s.message)] : []),
    h(
      "div",
      "display:flex;justify-content:center;gap:10px",
      { role: "timer" },
      ...UNITS.map((unit) =>
        h(
          "div",
          "min-width:48px",
          {},
          h(
            "div",
            `font-size:22px;font-weight:700;color:${s.colors.accent};font-variant-numeric:tabular-nums`,
            { "data-app-digit": "" },
            "00",
          ),
          h("div", "font-size:11px;opacity:.75", {}, earlyT(locale, unit)),
        ),
      ),
    ),
  );
}

/** বাকি সময় লেখে; কত সেকেন্ড বাকি তা ফেরত দেয় */
export function showLeft(box: HTMLElement, end: number, now = Date.now()): number {
  const left = Math.max(0, Math.floor((end - now) / 1000));
  const values = [
    Math.floor(left / 86400),
    Math.floor((left % 86400) / 3600),
    Math.floor((left % 3600) / 60),
    left % 60,
  ];
  box.querySelectorAll("[data-app-digit]").forEach((el, i) => {
    el.textContent = String(values[i]).padStart(2, "0");
  });
  return left;
}
