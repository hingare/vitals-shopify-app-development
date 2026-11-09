import type { ToolContext } from "../types";
import { productForm } from "../product";

interface Settings {
  animation: "shake" | "pulse" | "bounce" | "wobble";
  intervalSeconds: number;
}

const KEYFRAMES: Record<Settings["animation"], string> = {
  shake:
    "0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-4px)}40%,80%{transform:translateX(4px)}",
  pulse: "0%,100%{transform:scale(1)}50%{transform:scale(1.06)}",
  bounce:
    "0%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}60%{transform:translateY(2px)}",
  wobble: "0%,100%{transform:rotate(0)}25%{transform:rotate(-3deg)}75%{transform:rotate(3deg)}",
};

/** Add to cart বাটন কয়েক সেকেন্ড পরপর হালকা নড়ে (যারা কম নড়াচড়া চান তাদের জন্য বন্ধ) */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType !== "product") return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const button = productForm()?.querySelector<HTMLElement>(
    '[name="add"], [type="submit"], button:not([type="button"])',
  );
  if (!button) return;
  const style = document.createElement("style");
  style.textContent = `@keyframes app-atc{${KEYFRAMES[s.animation] ?? KEYFRAMES.shake}}.app-atc-anim{animation:app-atc .7s ease-in-out}`;
  document.head.appendChild(style);
  button.addEventListener("animationend", () => button.classList.remove("app-atc-anim"));
  setInterval(() => {
    if (document.visibilityState !== "visible" || (button as HTMLButtonElement).disabled) return;
    button.classList.add("app-atc-anim");
  }, s.intervalSeconds * 1000);
}
