import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { bottomOffset, isMobile } from "../dom";

interface Settings {
  position: "bottom-right" | "bottom-left";
  showAfter: number;
  showOnMobile: boolean;
  colors: { background: string; text: string };
}

/** অনেক নিচে নামলে "উপরে যান" বাটন; চ্যাট বাটন একই কোণে থাকলে তার উপরে বসে */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (!s.showOnMobile && isMobile()) return;
  const side = s.position === "bottom-left" ? "left" : "right";
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", widgetT(config.locale, "backToTop"));
  button.innerHTML =
    '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>';
  button.style.cssText = `position:fixed;${side}:20px;z-index:2147482400;width:44px;height:44px;border:0;border-radius:50%;cursor:pointer;display:none;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.2);background:${s.colors.background};color:${s.colors.text}`;
  button.addEventListener("click", () => {
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  });
  document.body.appendChild(button);

  const update = () => {
    const visible = scrollY > s.showAfter;
    button.style.display = visible ? "flex" : "none";
    if (!visible) return;
    const chat = document.querySelector<HTMLElement>("#app-chat-button a");
    const sameCorner = chat?.style[side] !== undefined && chat.style[side] !== "";
    button.style.bottom = `${20 + bottomOffset() + (sameCorner ? 64 : 0)}px`;
  };
  addEventListener("scroll", update, { passive: true });
  update();
}
