import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { placeAfterProductForm, readPageProduct } from "../product";

const TOOL_ID = "size-chart";

interface Settings {
  buttonText: string;
  title: string;
  chart: string;
  note: string;
  onlyTag: string;
  colors: { background: string; text: string; accent: string };
}

/** "Size, Chest\nS, 36" → সারি আর ঘর */
export function parseChart(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(",").map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css = "", text = "") {
  const node = document.createElement(tag);
  if (css) node.style.cssText = css;
  if (text) node.textContent = text;
  return node;
}

/** সাইজ চার্ট বাটন; চাপলে ব্রাউজারের নিজের <dialog>-এ টেবিল (Esc আর ফোকাস নিজে থেকেই ঠিক থাকে) */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType !== "product") return;
  const product = readPageProduct();
  const tag = s.onlyTag.trim().toLowerCase();
  if (tag && !product?.tags?.some((t) => t.trim().toLowerCase() === tag)) return;
  const rows = parseChart(s.chart);
  if (rows.length === 0) return;

  const dialog = el(
    "dialog",
    `max-width:min(640px,calc(100vw - 32px));width:100%;border:0;border-radius:12px;padding:24px;background:${s.colors.background};color:${s.colors.text}`,
  );
  dialog.setAttribute("aria-label", s.title || s.buttonText);
  const close = el(
    "button",
    "position:absolute;top:6px;right:6px;border:0;background:none;color:inherit;font-size:24px;min-width:40px;min-height:40px;cursor:pointer",
    "×",
  );
  close.type = "button";
  close.setAttribute("aria-label", widgetT(config.locale, "close"));
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());
  if (s.title) dialog.appendChild(el("h2", "margin:0 0 16px;font-size:20px", s.title));
  const scroll = el("div", "overflow-x:auto");
  const table = el("table", "width:100%;border-collapse:collapse;font-size:14px");
  rows.forEach((row, r) => {
    const tr = el("tr", r % 2 ? "" : "background:rgba(0,0,0,.04)");
    for (const cell of row) {
      const td = el(
        r === 0 ? "th" : "td",
        "padding:8px 10px;text-align:left;border-bottom:1px solid rgba(0,0,0,.08)",
        cell,
      );
      if (r === 0) td.setAttribute("scope", "col");
      tr.appendChild(td);
    }
    table.appendChild(tr);
  });
  scroll.appendChild(table);
  dialog.append(close, scroll);
  if (s.note) dialog.appendChild(el("p", "margin:12px 0 0;font-size:13px;opacity:.75", s.note));
  document.body.appendChild(dialog);

  const button = el(
    "button",
    `background:none;border:0;padding:6px 0;color:${s.colors.accent};text-decoration:underline;cursor:pointer;font:inherit;min-height:32px`,
    s.buttonText,
  );
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.addEventListener("click", () => {
    track(TOOL_ID, "click");
    dialog.showModal();
  });
  placeAfterProductForm(TOOL_ID).appendChild(button);
}
