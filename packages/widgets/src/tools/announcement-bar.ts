import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { barHost } from "../dom";
import { adopt } from "../early/run";
import {
  type AnnouncementSettings,
  CLOSED_KEY,
  announcementMessages,
  buildAnnouncement,
} from "../early/bars";

const TOOL_ID = "announcement-bar";

/**
 * সব পেজের উপরে বা নিচে ঘোষণা; বন্ধ করলে এই ভিজিটে আর দেখায় না।
 * উপরের বার পাতা আঁকার আগেই বসে (early.ts); এখানে শুধু মেসেজ বদলানো আর বন্ধ করা চালু হয়।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as AnnouncementSettings;
  const messages = announcementMessages(s);
  if (!messages) return;
  const host = adopt(TOOL_ID) ?? barHost(s.position, TOOL_ID, s.sticky);
  if (!host.firstChild) {
    host.appendChild(buildAnnouncement(s, messages, widgetT(config.locale, "close")));
  }
  track(TOOL_ID, "view");

  const items = [...host.querySelectorAll<HTMLElement>("[data-app-message]")];
  let index = 0;
  const timer =
    items.length > 1
      ? setInterval(() => {
          items[index]!.style.visibility = "hidden";
          index = (index + 1) % items.length;
          items[index]!.style.visibility = "visible";
        }, s.rotateSeconds * 1000)
      : undefined;
  for (const link of host.querySelectorAll("a")) {
    link.addEventListener("click", () => track(TOOL_ID, "click"));
  }
  host.querySelector("button")?.addEventListener("click", () => {
    try {
      sessionStorage.setItem(CLOSED_KEY, messages.join("|"));
    } catch {
      // private mode
    }
    clearInterval(timer);
    host.remove();
  });
}
