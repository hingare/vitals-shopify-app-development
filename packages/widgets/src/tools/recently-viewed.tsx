import { render } from "preact";
import type { ToolContext } from "../types";
import { track } from "../analytics";
import { store } from "../dom";
import { ProductGrid } from "../grid";
import {
  type AjaxProduct,
  fetchProduct,
  placeAfterProductSection,
  slotHost,
  readPageProduct,
} from "../product";

const TOOL_ID = "recently-viewed";
const KEY = "app_recently_viewed";
const MAX = 20;

interface Settings {
  heading: string;
  limit: number;
  showOn: "everywhere" | "product";
  colors: { background: string; text: string; accent: string };
}

/** আগে দেখা প্রোডাক্টের handle-এর তালিকা (নতুনটা আগে) */
export function remember(list: string[], handle: string, max = MAX): string[] {
  return [handle, ...list.filter((h) => h !== handle)].slice(0, max);
}

function readList(): string[] {
  try {
    const list = JSON.parse(store.get(KEY) ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}

export async function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const current = config.pageType === "product" ? readPageProduct()?.handle : undefined;
  const list = readList();
  if (current) store.set(KEY, JSON.stringify(remember(list, current)));
  if (s.showOn === "product" && !current) return;

  const handles = list.filter((h) => h !== current).slice(0, s.limit);
  if (handles.length === 0) return;
  const products = (await Promise.all(handles.map(fetchProduct))).filter(
    (p): p is AjaxProduct => p !== null,
  );
  if (products.length === 0) return;

  let host = current ? placeAfterProductSection(TOOL_ID) : slotHost(TOOL_ID);
  if (!host) {
    host = document.createElement("div");
    host.dataset.appWidget = TOOL_ID;
    (document.querySelector("main") ?? document.body).appendChild(host);
  }
  track(TOOL_ID, "view");
  render(
    <ProductGrid
      toolId={TOOL_ID}
      heading={s.heading}
      products={products}
      currency={config.currency}
      locale={config.locale}
      colors={s.colors}
    />,
    host,
  );
}
