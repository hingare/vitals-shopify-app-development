import type { ToolContext } from "../types";
import { fetchCart, onCartChange } from "../cart";

interface Settings {
  colors: { background: string; text: string };
}

/** ট্যাবের আইকনে কার্টের আইটেম সংখ্যা */
export function mount({ settings }: ToolContext) {
  const s = settings as unknown as Settings;
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  const original = link?.href ?? "";
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  const icon = link;

  const base = new Image();
  base.crossOrigin = "anonymous";
  let baseReady = false;
  base.onload = () => {
    baseReady = true;
    void update();
  };
  if (original) base.src = original;

  async function update() {
    const count = (await fetchCart())?.item_count ?? 0;
    if (count === 0) {
      if (original) icon.href = original;
      return;
    }
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (baseReady) ctx.drawImage(base, 0, 0, size, size);
    const r = baseReady ? 20 : 30;
    ctx.fillStyle = s.colors.background;
    ctx.beginPath();
    ctx.arc(size - r, baseReady ? r : size / 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s.colors.text;
    ctx.font = `bold ${baseReady ? 28 : 38}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(count > 9 ? "9+" : String(count), size - r, (baseReady ? r : size / 2) + 2);
    try {
      icon.href = canvas.toDataURL("image/png");
    } catch {
      // আইকনের সার্ভার অনুমতি না দিলে আগের আইকনই থাকে
    }
  }

  void update();
  onCartChange(() => void update());
}
