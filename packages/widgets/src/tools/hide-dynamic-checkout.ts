import type { ToolContext } from "../types";

interface Settings {
  hideOnProduct: boolean;
  hideOnCart: boolean;
}

/** Liquid আগেই লুকিয়ে দেয়; এটা শুধু নিশ্চিত করে (যেমন থিম পরে বাটন বসালে) */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const rules: string[] = [];
  if (s.hideOnProduct && config.pageType === "product") {
    rules.push(".shopify-payment-button{display:none!important}");
  }
  if (s.hideOnCart) {
    rules.push(
      '.additional-checkout-buttons,[data-shopify="dynamic-checkout-cart"]{display:none!important}',
    );
  }
  if (rules.length === 0) return;
  const style = document.createElement("style");
  style.textContent = rules.join("");
  document.head.appendChild(style);
}
