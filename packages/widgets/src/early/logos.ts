/**
 * পেমেন্ট লোগো। লোগোগুলো Liquid আগেই পাতায় রেখে দেয় (<template id="app-payment-icons">, app embed-এ),
 * তাই early.ts পাতা আঁকার আগেই Add to cart-এর নিচে বা কার্টে চেকআউটের কাছে বসাতে পারে।
 */
import { h } from "./h";

export interface LogosSettings {
  heading: string;
  showOnProduct: boolean;
  showOnCart: boolean;
  showInFooter: boolean;
  iconSize: number;
  grayscale: boolean;
}

/** স্টোরে চালু পেমেন্টের লোগোর template; একটাও লোগো না থাকলে null */
export function paymentIcons(): HTMLTemplateElement | null {
  const template = document.getElementById("app-payment-icons") as HTMLTemplateElement | null;
  return template?.content.querySelector("svg") ? template : null;
}

export function buildLogos(s: LogosSettings, template: HTMLTemplateElement): HTMLElement {
  const row = h(
    "div",
    `display:flex;flex-wrap:wrap;justify-content:center;gap:6px;${s.grayscale ? "filter:grayscale(1)" : ""}`,
  );
  row.append(template.content.cloneNode(true));
  for (const svg of row.querySelectorAll("svg")) {
    svg.style.height = `${s.iconSize}px`;
    svg.style.width = "auto";
  }
  return h(
    "div",
    "margin:16px 0;text-align:center",
    {},
    ...(s.heading ? [h("p", "margin:0 0 8px;font-size:13px;opacity:.8", {}, s.heading)] : []),
    row,
  );
}
