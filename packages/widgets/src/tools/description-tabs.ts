import type { ToolContext } from "../types";
import { isMobile } from "../dom";
import { productForm } from "../product";

interface Settings {
  style: "tabs" | "accordion";
  firstTabTitle: string;
  accordionOnMobile: boolean;
  colors: { background: string; text: string; accent: string };
}

const DESCRIPTION =
  ".product__description, .product-single__description, .product-description, [itemprop='description'], .product__info-container .rte";

interface Part {
  title: string;
  nodes: Node[];
}

/** বিবরণের সবচেয়ে বড় শিরোনাম (h2/h3/h4) ধরে ভাগ করে; শিরোনাম না থাকলে কিছুই করে না */
export function split(el: HTMLElement, firstTitle: string): Part[] | null {
  const level = ["H2", "H3", "H4"].find((h) => el.querySelector(`:scope > ${h}`));
  if (!level) return null;
  const parts: Part[] = [{ title: firstTitle, nodes: [] }];
  for (const node of [...el.childNodes]) {
    if (node instanceof HTMLElement && node.tagName === level) {
      parts.push({ title: node.textContent?.trim() || firstTitle, nodes: [] });
    } else parts[parts.length - 1]!.nodes.push(node);
  }
  const hasText = (p: Part) =>
    p.nodes.some((n) => n.textContent?.trim() || n instanceof HTMLImageElement);
  const kept = parts.filter((p, i) => i > 0 || hasText(p));
  return kept.length > 1 ? kept : null;
}

let uid = 0;

function tabs(el: HTMLElement, parts: Part[], s: Settings) {
  const id = `app-tabs-${uid++}`;
  const list = document.createElement("div");
  list.setAttribute("role", "tablist");
  list.style.cssText = `display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid rgba(0,0,0,.12);margin-bottom:12px`;
  const buttons: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];
  const select = (index: number, focus = false) => {
    buttons.forEach((b, i) => {
      const on = i === index;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      b.style.borderBottomColor = on ? s.colors.accent : "transparent";
      b.style.fontWeight = on ? "600" : "400";
      panels[i]!.hidden = !on;
    });
    if (focus) buttons[index]!.focus();
  };
  parts.forEach((part, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `${id}-tab-${i}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `${id}-panel-${i}`);
    button.textContent = part.title;
    button.style.cssText = `background:none;border:0;border-bottom:2px solid transparent;padding:10px 12px;cursor:pointer;color:${s.colors.text};font:inherit;min-height:44px`;
    button.addEventListener("click", () => select(i));
    button.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (step) select((i + step + parts.length) % parts.length, true);
    });
    const panel = document.createElement("div");
    panel.id = `${id}-panel-${i}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    panel.append(...part.nodes);
    buttons.push(button);
    panels.push(panel);
    list.appendChild(button);
  });
  el.replaceChildren(list, ...panels);
  select(0);
}

function accordion(el: HTMLElement, parts: Part[], s: Settings) {
  el.replaceChildren(
    ...parts.map((part, i) => {
      const details = document.createElement("details");
      details.open = i === 0;
      details.style.cssText = "border-bottom:1px solid rgba(0,0,0,.12);padding:4px 0";
      const summary = document.createElement("summary");
      summary.textContent = part.title;
      summary.style.cssText = `cursor:pointer;padding:10px 0;font-weight:600;color:${s.colors.text}`;
      details.append(summary, ...part.nodes);
      return details;
    }),
  );
}

export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType !== "product") return;
  const scope = productForm()?.closest(".shopify-section") ?? document.querySelector("main");
  const el = scope?.querySelector<HTMLElement>(DESCRIPTION);
  if (!el || el.dataset.appTabs) return;
  const parts = split(el, s.firstTabTitle);
  if (!parts) return;
  el.dataset.appTabs = "1";
  if (s.style === "accordion" || (s.accordionOnMobile && isMobile())) accordion(el, parts, s);
  else tabs(el, parts, s);
}
