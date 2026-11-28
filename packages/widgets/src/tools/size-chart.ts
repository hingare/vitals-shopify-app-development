import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { placeAfterProductForm, readPageProduct } from "../product";
import { adopt, takeTap } from "../early/run";
import { type ChartSettings, buildChartButton, chartShows, parseChart } from "../early/size-chart";

export { parseChart };

const TOOL_ID = "size-chart";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css = "", text = "") {
  const node = document.createElement(tag);
  if (css) node.style.cssText = css;
  if (text) node.textContent = text;
  return node;
}

/**
 * সাইজ চার্ট বাটন; চাপলে ব্রাউজারের নিজের <dialog>-এ টেবিল (Esc আর ফোকাস নিজে থেকেই ঠিক থাকে)।
 * বাটনটা early.ts পাতা আঁকার আগেই বসায়; এখানে চার্টের জানালা জুড়ে দেওয়া হয়।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as ChartSettings;
  if (config.pageType !== "product" || !chartShows(s, readPageProduct())) return;
  const rows = parseChart(s.chart);

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

  const host = adopt(TOOL_ID);
  const early = host?.querySelector("button");
  const button = early ?? buildChartButton(s);
  button.addEventListener("click", () => {
    track(TOOL_ID, "click");
    dialog.showModal();
  });
  if (!early) placeAfterProductForm(TOOL_ID).appendChild(button);
  // ফাইল আসার আগেই কেউ চেপে থাকলে
  if (host) takeTap(host)?.click();
}
