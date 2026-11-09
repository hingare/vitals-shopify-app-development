import type { ToolContext } from "../types";
import { fetchCart } from "../cart";

interface Settings {
  message: string;
  onlyWithCart: boolean;
}

/** ক্রেতা অন্য ট্যাবে গেলে ট্যাবের শিরোনাম বদলায়, ফিরে এলে আগের মতো করে */
export function mount({ settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (!s.message) return;
  let original = document.title;
  let changed = false;
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "hidden") {
      if (s.onlyWithCart && !((await fetchCart())?.item_count ?? 0)) return;
      if (document.visibilityState !== "hidden") return;
      original = document.title;
      document.title = s.message;
      changed = true;
    } else if (changed) {
      document.title = original;
      changed = false;
    }
  });
}
