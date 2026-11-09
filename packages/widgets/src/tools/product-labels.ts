import type { ToolContext } from "../types";
import { type LabelProduct, type LabelSettings, labelsFor } from "../labels";
import { fetchProduct, productForm, readPageProduct } from "../product";

interface Settings extends LabelSettings {
  corner: "top-left" | "top-right";
  showOnCards: boolean;
  colors: { background: string; text: string };
}

/** থিমের প্রোডাক্ট কার্ড (Dawn, পুরনো থিম, অন্যান্য জনপ্রিয় থিম) */
const CARD =
  ".card-wrapper, .product-card, .grid-product, .product-item, .grid__item, .product-grid-item";
const MAX_CARDS = 24;

function badge(host: HTMLElement, texts: string[], s: Settings) {
  if (texts.length === 0 || host.querySelector(":scope > .app-label")) return;
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  const side = s.corner === "top-right" ? "right" : "left";
  const box = document.createElement("div");
  box.className = "app-label";
  box.style.cssText = `position:absolute;top:8px;${side}:8px;z-index:2;display:flex;flex-direction:column;gap:4px;align-items:flex-${side === "left" ? "start" : "end"};pointer-events:none`;
  for (const text of texts) {
    const span = document.createElement("span");
    span.textContent = text;
    span.style.cssText = `background:${s.colors.background};color:${s.colors.text};font-size:12px;font-weight:600;line-height:1;padding:5px 8px;border-radius:4px`;
    box.appendChild(span);
  }
  host.appendChild(box);
}

/** ছবির ঘর: ছবির ঠিক উপরের element-এ লেবেল বসে */
const imageBox = (img: HTMLImageElement | null) => img?.parentElement ?? null;

export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;

  if (config.pageType === "product") {
    const p = readPageProduct();
    const section = productForm()?.closest(".shopify-section") ?? document.querySelector("main");
    const img = [...(section?.querySelectorAll<HTMLImageElement>("img") ?? [])].find(
      (i) => i.width >= 200 || i.closest("[class*='media'], [class*='gallery']"),
    );
    const host = imageBox(img ?? null);
    if (p && host) {
      const product: LabelProduct = {
        price: p.priceCents,
        compareAt: p.compareAtCents,
        available: p.available,
        tags: p.tags,
        createdAt: p.createdAt,
      };
      badge(host, labelsFor(product, s), s);
    }
  }

  if (!s.showOnCards) return;
  const cards = [...document.querySelectorAll<HTMLElement>(CARD)]
    .filter((card) => !card.closest("[data-app-widget]") && !card.parentElement?.closest(CARD))
    .slice(0, MAX_CARDS);
  for (const card of cards) {
    const handle = /\/products\/([^/?#]+)/.exec(
      card.querySelector<HTMLAnchorElement>('a[href*="/products/"]')?.href ?? "",
    )?.[1];
    const host = imageBox(card.querySelector("img"));
    if (!handle || !host) continue;
    void fetchProduct(decodeURIComponent(handle)).then((p) => {
      if (!p) return;
      badge(
        host,
        labelsFor(
          {
            price: p.price,
            compareAt: p.compare_at_price,
            available: p.available,
            tags: p.tags,
            createdAt: p.created_at,
          },
          s,
        ),
        s,
      );
    });
  }
}
