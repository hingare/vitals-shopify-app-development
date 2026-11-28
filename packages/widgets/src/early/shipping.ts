/** ডেলিভারির তারিখ (Shipping Info): early.ts পাতা আঁকার আগেই বসায়, টুলের ফাইল প্রতি মিনিটে আবার লেখে */
import { deliveryWindow, formatDay, formatDuration } from "../dates";
import { fill } from "../dom";
import { h, icon } from "./h";

export interface ShippingSettings {
  minDays: number;
  maxDays: number;
  skipWeekends: boolean;
  cutoffHour: number;
  deliveryMessage: string;
  cutoffMessage: string;
  colors: { background: string; text: string; accent: string };
}

const TRUCK =
  '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>';

export function buildShipping(
  s: ShippingSettings,
  tz: string | undefined,
  locale: string,
  now = Date.now(),
): HTMLElement {
  const w = deliveryWindow(now, tz, s);
  const start = formatDay(w.start, locale);
  const end = formatDay(w.end, locale);
  const delivery = fill(s.deliveryMessage, { start, end: end === start ? start : end }).replace(
    `${start} – ${start}`,
    start,
  );
  return h(
    "div",
    `margin:12px 0;padding:12px;border-radius:8px;background:${s.colors.background};color:${s.colors.text};display:flex;gap:10px;align-items:flex-start`,
    {},
    icon(
      22,
      {
        stroke: s.colors.accent,
        "stroke-width": "1.7",
        "stroke-linejoin": "round",
        style: "flex:none",
      },
      TRUCK,
    ),
    h(
      "div",
      "",
      {},
      h("div", "", {}, delivery),
      ...(s.cutoffMessage && w.cutoffIn !== null
        ? [
            h(
              "div",
              "font-size:13px;margin-top:2px",
              {},
              fill(s.cutoffMessage, { time: formatDuration(w.cutoffIn) }),
            ),
          ]
        : []),
    ),
  );
}
