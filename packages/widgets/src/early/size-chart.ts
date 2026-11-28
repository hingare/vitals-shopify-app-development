/** সাইজ চার্টের বাটন: early.ts পাতা আঁকার আগেই বসায়, টুলের ফাইল পরে এসে চার্টের জানালা জুড়ে দেয় */
import type { PageProduct } from "../product";
import { h } from "./h";

export interface ChartSettings {
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

/** এই প্রোডাক্টে বাটন দেখাবে কিনা: চার্ট আছে, আর ট্যাগ বেছে দিলে প্রোডাক্টে সেই ট্যাগ আছে */
export function chartShows(s: ChartSettings, product: PageProduct | null): boolean {
  const tag = s.onlyTag.trim().toLowerCase();
  if (tag && !product?.tags?.some((t) => t.trim().toLowerCase() === tag)) return false;
  return parseChart(s.chart).length > 0;
}

export function buildChartButton(s: ChartSettings): HTMLButtonElement {
  return h(
    "button",
    `background:none;border:0;padding:6px 0;color:${s.colors.accent};text-decoration:underline;cursor:pointer;font:inherit;min-height:32px`,
    { type: "button", "aria-haspopup": "dialog" },
    s.buttonText,
  );
}
