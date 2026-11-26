import type { ToolContext } from "../types";
import { track } from "../analytics";
import { placeAfterProductForm } from "../product";
import { adopt } from "../early/run";
import { type CountdownSettings, buildCountdown, endsAt, showLeft } from "../early/countdown";

const TOOL_ID = "countdown-timer";

/**
 * সেল শেষ হওয়া পর্যন্ত কাউন্টডাউন; শেষ হলে নিজে থেকে সরে যায়।
 * বাক্সটা পাতা আঁকার আগেই বসে (early.ts); এখানে প্রতি সেকেন্ডে সংখ্যা বদলায়।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as CountdownSettings;
  if (config.pageType !== "product" || !s.endDate) return;
  const end = endsAt(s.endDate, s.endTime, config.tzOffset);
  if (!(end > Date.now())) return;
  const host = adopt(TOOL_ID) ?? placeAfterProductForm(TOOL_ID);
  if (!host.firstChild) host.appendChild(buildCountdown(s, config.locale));
  const box = host.firstElementChild as HTMLElement;
  track(TOOL_ID, "view");
  const tick = () => {
    if (showLeft(box, end) > 0) return;
    clearInterval(timer);
    host.replaceChildren();
  };
  const timer = setInterval(tick, 1000);
  tick();
}
