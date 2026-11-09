import type { ToolContext } from "../types";
import { track } from "../analytics";
import { placeAfterProductForm, placeNearCheckout } from "../product";

const TOOL_ID = "payment-logos";

interface Settings {
  heading: string;
  showOnProduct: boolean;
  showOnCart: boolean;
  showInFooter: boolean;
  iconSize: number;
  grayscale: boolean;
}

/** লোগোগুলো Liquid আগেই পেজে রেখে দেয় (<template id="app-payment-icons">); এখানে শুধু জায়গামতো বসাই */
function logos(s: Settings, template: HTMLTemplateElement): HTMLElement {
  const box = document.createElement("div");
  box.style.cssText = "margin:16px 0;text-align:center";
  if (s.heading) {
    const heading = document.createElement("p");
    heading.textContent = s.heading;
    heading.style.cssText = "margin:0 0 8px;font-size:13px;opacity:.8";
    box.appendChild(heading);
  }
  const row = document.createElement("div");
  row.style.cssText = `display:flex;flex-wrap:wrap;justify-content:center;gap:6px;${
    s.grayscale ? "filter:grayscale(1)" : ""
  }`;
  row.appendChild(template.content.cloneNode(true));
  for (const svg of row.querySelectorAll("svg")) {
    svg.style.height = `${s.iconSize}px`;
    svg.style.width = "auto";
  }
  box.appendChild(row);
  return box;
}

export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const template = document.getElementById("app-payment-icons") as HTMLTemplateElement | null;
  if (!template?.content.querySelector("svg")) return;
  const hosts: HTMLElement[] = [];
  if (s.showOnProduct && config.pageType === "product") hosts.push(placeAfterProductForm(TOOL_ID));
  if (s.showOnCart && config.pageType === "cart") hosts.push(placeNearCheckout(TOOL_ID));
  const footer = document.querySelector("footer");
  if (s.showInFooter && footer) {
    const host = document.createElement("div");
    footer.appendChild(host);
    hosts.push(host);
  }
  if (hosts.length === 0) return;
  for (const host of hosts) host.appendChild(logos(s, template));
  track(TOOL_ID, "view");
}
