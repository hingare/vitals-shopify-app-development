import type { ToolContext } from "../types";

interface Settings {
  protectImages: boolean;
  disableTextSelection: boolean;
  disableRightClick: boolean;
  disableShortcuts: boolean;
}

/** ফর্মে লেখা বা কপি করা কখনো আটকায় না (ক্রেতার ঠিকানা, কুপন ইত্যাদি) */
const editable = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest("input, textarea, select, [contenteditable]"));

/** ছবি আর লেখা সহজে কপি করা কঠিন করে */
export function mount({ settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const css: string[] = [];
  if (s.protectImages)
    css.push("img{-webkit-user-drag:none;user-drag:none;-webkit-touch-callout:none}");
  if (s.disableTextSelection) {
    css.push(
      "body{-webkit-user-select:none;user-select:none}input,textarea,[contenteditable]{-webkit-user-select:text;user-select:text}",
    );
  }
  if (css.length) {
    const style = document.createElement("style");
    style.textContent = css.join("");
    document.head.appendChild(style);
  }

  document.addEventListener("contextmenu", (e) => {
    if (editable(e.target)) return;
    if (s.disableRightClick || (s.protectImages && e.target instanceof HTMLImageElement)) {
      e.preventDefault();
    }
  });
  if (s.protectImages) {
    document.addEventListener("dragstart", (e) => {
      if (e.target instanceof HTMLImageElement) e.preventDefault();
    });
  }
  if (s.disableShortcuts) {
    document.addEventListener("keydown", (e) => {
      if (editable(e.target) || !(e.ctrlKey || e.metaKey)) return;
      if (["c", "s", "u", "p"].includes(e.key.toLowerCase())) e.preventDefault();
    });
  }
}
