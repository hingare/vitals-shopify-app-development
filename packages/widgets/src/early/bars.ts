import { isMobile, fill } from "../dom";
import { money } from "../product";
import { currencyRate } from "../cart";
import { h } from "./h";

/**
 * উপরের বার (ঘোষণা, স্পেন্ডিং গোল): পাতা আঁকার আগে early.ts এগুলো বানায়, টুলের ফাইল পরে এসে
 * শুধু চালু করে (মেসেজ বদলানো, বন্ধ করা, কার্ট বদলালে লেখা বদলানো)।
 */

interface Colors {
  background: string;
  text: string;
  accent: string;
}

export interface AnnouncementSettings {
  message1: string;
  message2: string;
  message3: string;
  link: string;
  rotateSeconds: number;
  position: "top" | "bottom";
  sticky: boolean;
  closable: boolean;
  showOnMobile: boolean;
  colors: Colors;
}

export const CLOSED_KEY = "app_announcement_closed";

/** দেখানোর মেসেজগুলো; বার না দেখানোর হলে (মোবাইলে বন্ধ, এই ভিজিটে ক্রেতা বন্ধ করেছেন) null */
export function announcementMessages(s: AnnouncementSettings): string[] | null {
  if (!s.showOnMobile && isMobile()) return null;
  const messages = [s.message1, s.message2, s.message3].filter((m) => m && m.trim());
  if (messages.length === 0) return null;
  try {
    if (sessionStorage.getItem(CLOSED_KEY) === messages.join("|")) return null;
  } catch {
    // private mode
  }
  return messages;
}

/**
 * ঘোষণার বার। সব মেসেজ একই ঘরে একটার ওপর আরেকটা (grid), একবারে একটাই দেখা যায়; তাই বারের
 * উচ্চতা সবচেয়ে লম্বা মেসেজের সমান থাকে আর মেসেজ বদলালে পাতা নড়ে না।
 */
export function buildAnnouncement(
  s: AnnouncementSettings,
  messages: string[],
  closeLabel: string,
): HTMLElement {
  const stack = h(
    "div",
    "display:grid",
    { "aria-live": "polite" },
    ...messages.map((message, i) => {
      const css = `grid-area:1/1${i > 0 ? ";visibility:hidden" : ""}`;
      return s.link
        ? h(
            "a",
            `${css};color:inherit;text-decoration:underline;text-decoration-color:${s.colors.accent}`,
            { href: s.link, "data-app-message": "" },
            message,
          )
        : h("span", css, { "data-app-message": "" }, message);
    }),
  );
  return h(
    "div",
    `position:relative;background:${s.colors.background};color:${s.colors.text};padding:${s.closable ? "9px 40px" : "9px 16px"};text-align:center;font-size:14px`,
    { role: "region", "aria-label": messages[0]! },
    stack,
    ...(s.closable
      ? [
          h(
            "button",
            "position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:0;color:inherit;font-size:20px;line-height:1;cursor:pointer;min-width:36px;min-height:36px",
            { type: "button", "aria-label": closeLabel },
            "×",
          ),
        ]
      : []),
  );
}

export interface GoalSettings {
  goal: number;
  messageEmpty: string;
  messageProgress: string;
  messageDone: string;
  position: "top" | "bottom";
  showOnMobile: boolean;
  colors: Colors;
}

/**
 * স্পেন্ডিং গোলের বার: লেখা আর অগ্রগতির দাগ। কার্ট খালি থাকলেও দাগটা থাকে (০%), যাতে কার্ট
 * বদলালে বারের উচ্চতা না বদলায়।
 */
export function buildGoal(s: GoalSettings): HTMLElement {
  return h(
    "div",
    `background:${s.colors.background};color:${s.colors.text};padding:8px 16px;text-align:center;font-size:14px`,
    { role: "status" },
    h("div"),
    h(
      "div",
      "max-width:360px;height:6px;margin:6px auto 0;border-radius:3px;background:rgba(0,0,0,.1);overflow:hidden",
      { "aria-hidden": "true" },
      h("div", `width:0;height:100%;background:${s.colors.accent};transition:width .4s`),
    ),
  );
}

/** কার্ট অনুযায়ী লেখা আর দাগ (total সেন্টে, ক্রেতার মুদ্রায়) */
export function showGoal(
  box: HTMLElement,
  s: GoalSettings,
  cart: { total: number; count: number },
  currency: string | undefined,
  locale: string,
) {
  const goal = Math.round(s.goal * 100 * currencyRate());
  const format = (cents: number) => money(cents, currency, locale);
  const left = goal - cart.total;
  (box.firstElementChild as HTMLElement).textContent =
    cart.count === 0
      ? fill(s.messageEmpty, { goal: format(goal) })
      : left > 0
        ? fill(s.messageProgress, { amount: format(left), goal: format(goal) })
        : s.messageDone;
  const bar = box.lastElementChild?.firstElementChild as HTMLElement | null;
  if (bar) bar.style.width = `${cart.count === 0 ? 0 : Math.min(100, (cart.total / goal) * 100)}%`;
}
