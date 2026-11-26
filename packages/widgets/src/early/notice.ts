/** Cart Notice-এর বার্তা: কার্ট পেজে পাতা আঁকার আগে early.ts বানায়, Cart Drawer-ও একই বার্তা দেখায় */
import { h } from "./h";

const ICONS = { info: "ℹ️", truck: "🚚", gift: "🎁", clock: "⏰", plain: "" } as const;

export interface NoticeSettings {
  noticeText: string;
  icon: keyof typeof ICONS;
  colors: { background: string; text: string; accent: string };
}

/** বার্তা না থাকলে null */
export function buildNotice(s: NoticeSettings): HTMLElement | null {
  if (!s.noticeText) return null;
  const icon = ICONS[s.icon] ?? "";
  return h(
    "p",
    `margin:12px 0;padding:10px 14px;border-radius:8px;background:${s.colors.background};color:${s.colors.text};font-size:14px`,
    { role: "note" },
    ...(icon ? [h("span", "margin-right:6px", { "aria-hidden": "true" }, icon)] : []),
    s.noticeText,
  );
}
