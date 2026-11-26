import { isMobile } from "../dom";
import { productForm } from "../product";
import { h } from "./h";

/**
 * Description Tabs: প্রোডাক্টের বিবরণ শিরোনাম ধরে ট্যাব বা accordion-এ ভাগ করা। early.ts থিমের HTML
 * পড়ার সময় বিবরণটা পুরো পড়া হলেই এটা করে (পাতা আঁকার আগে, তাই নিচের লেখা পরে লাফায় না); কোনো
 * কারণে তখন না হলে টুলের ফাইল করে।
 */

export interface TabsSettings {
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

function tabs(el: HTMLElement, parts: Part[], s: TabsSettings) {
  const id = `app-tabs-${uid++}`;
  const last = parts.length - 1;
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
  const buttons = parts.map((part, i) => {
    const button = h(
      "button",
      `background:none;border:0;border-bottom:2px solid transparent;padding:10px 12px;cursor:pointer;color:${s.colors.text};font:inherit;min-height:44px`,
      { type: "button", id: `${id}-tab-${i}`, role: "tab", "aria-controls": `${id}-panel-${i}` },
      part.title,
    );
    button.addEventListener("click", () => select(i));
    button.addEventListener("keydown", (e) => {
      const to = {
        ArrowRight: i === last ? 0 : i + 1,
        ArrowLeft: i ? i - 1 : last,
        Home: 0,
        End: last,
      }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      select(to, true);
    });
    return button;
  });
  // লিংক ছাড়া লেখা থাকলেও Tab দিয়ে প্যানেলে পৌঁছানো যায় (ARIA-র ট্যাব নিয়ম), তাই tabindex 0
  const panels = parts.map((part, i) =>
    h(
      "div",
      "",
      {
        id: `${id}-panel-${i}`,
        role: "tabpanel",
        "aria-labelledby": `${id}-tab-${i}`,
        tabindex: "0",
      },
      ...part.nodes,
    ),
  );
  el.replaceChildren(
    h(
      "div",
      "display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid rgba(0,0,0,.12);margin-bottom:12px",
      { role: "tablist" },
      ...buttons,
    ),
    ...panels,
  );
  select(0);
}

function accordion(el: HTMLElement, parts: Part[], s: TabsSettings) {
  el.replaceChildren(
    ...parts.map((part, i) => {
      const details = h(
        "details",
        "border-bottom:1px solid rgba(0,0,0,.12);padding:4px 0",
        {},
        h(
          "summary",
          `cursor:pointer;padding:10px 0;font-weight:600;color:${s.colors.text}`,
          {},
          part.title,
        ),
        ...part.nodes,
      );
      details.open = i === 0;
      return details;
    }),
  );
}

/** প্রোডাক্টের বিবরণ: Add to cart ফর্মের সেকশনে, ফর্ম না পেলে main-এ */
export function findDescription(): HTMLElement | null {
  const scope = productForm()?.closest(".shopify-section") ?? document.querySelector("main");
  return scope?.querySelector<HTMLElement>(DESCRIPTION) ?? null;
}

/** বিবরণ ট্যাব বা accordion বানানো; আগেই করা থাকলে বা ভাগ করার মতো শিরোনাম না থাকলে কিছু না */
export function transform(el: HTMLElement, s: TabsSettings) {
  if (el.dataset.appTabs) return;
  const parts = split(el, s.firstTabTitle);
  if (!parts) return;
  el.dataset.appTabs = "1";
  if (s.style === "accordion" || (s.accordionOnMobile && isMobile())) accordion(el, parts, s);
  else tabs(el, parts, s);
}
