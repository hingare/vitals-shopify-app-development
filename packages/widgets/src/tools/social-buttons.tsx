import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { placeAfterProductForm } from "../product";
import { adopt } from "../early/run";
import { COPY, type SocialSettings, buildSocial, shareUrl } from "../early/social";

export { shareUrl };

const TOOL_ID = "social-buttons";

/**
 * প্রোডাক্ট শেয়ার করার বাটন। বাটনগুলো early.ts পাতা আঁকার আগেই বসায়; এখানে লিংক কপির কাজ আর গোনা
 * জুড়ে দেওয়া হয় (না থাকলে, যেমন পুরনো embed-এ, এখানেই বসানো)।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as SocialSettings;
  if (config.pageType !== "product" || s.networks.length === 0) return;
  let box = adopt(TOOL_ID)?.firstElementChild as HTMLElement | null | undefined;
  if (!box) {
    box = buildSocial(s, config.locale);
    placeAfterProductForm(TOOL_ID).appendChild(box);
  }
  for (const link of box.querySelectorAll("a")) {
    link.addEventListener("click", () => track(TOOL_ID, "click"));
  }
  const copy = box.querySelector<HTMLButtonElement>(`[${COPY}]`);
  copy?.addEventListener("click", () => {
    track(TOOL_ID, "click");
    void navigator.clipboard?.writeText(location.origin + location.pathname).then(() => {
      const label = copy.querySelector("span");
      if (label) label.textContent = widgetT(config.locale, "linkCopied");
    });
  });
}
