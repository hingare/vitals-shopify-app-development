import type { ToolContext } from "../types";

/**
 * AI FAQ সার্ভারেই লেখা হয় (থিমের "AI FAQ" ব্লক)। মার্চেন্ট ব্লকটা না বসালে app embed একই লেখা
 * <template id="app-ai-faq">-এ রাখে, আর এই কোড সেটা প্রোডাক্ট সেকশনের ঠিক পরে বসায়।
 */
export function mount({ config }: ToolContext) {
  if (config.pageType !== "product") return;
  if (document.querySelector("[data-app-ai-faq-block]")) return;
  const template = document.getElementById("app-ai-faq");
  if (!(template instanceof HTMLTemplateElement)) return;
  if (!document.querySelector("link[data-app-sections]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${config.assetBase}sections.css`;
    link.dataset.appSections = "";
    document.head.appendChild(link);
  }
  const host = document.createElement("div");
  host.id = "app-ai-faq-host";
  host.appendChild(template.content.cloneNode(true));
  const anchor =
    document
      .querySelector('main [id^="MainProduct"], main [id*="__main"]')
      ?.closest(".shopify-section") ?? document.querySelector("main .shopify-section");
  if (anchor) anchor.after(host);
  else (document.querySelector("main") ?? document.body).appendChild(host);
}
