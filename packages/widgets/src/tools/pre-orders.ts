import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { fill } from "../dom";
import {
  currentVariantId,
  onVariantChange,
  placeAfterProductForm,
  productForm,
  readPageProduct,
} from "../product";

const TOOL_ID = "pre-orders";

interface Settings {
  buttonText: string;
  preorderMessage: string;
  shipDate: string;
  onlyTag: string;
  colors: { background: string; text: string; accent: string };
}

/** ক্রেতাকে দেখানো আর অর্ডারের লাইনে রাখা লেখা */
export function preorderText(s: Settings, locale: string): string {
  if (!s.shipDate) {
    return s.preorderMessage.includes("{date}")
      ? widgetT(locale, "preorderNoDate")
      : s.preorderMessage;
  }
  const [y = 0, m = 1, d = 1] = s.shipDate.split("-").map(Number);
  let date = s.shipDate;
  try {
    date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(y, m - 1, d));
  } catch {
    // অচেনা locale: তারিখ যেমন আছে
  }
  return fill(s.preorderMessage, { date });
}

/** বাটনের ভেতরের যে অংশে লেখা থাকে (Dawn-এর মতো থিমে <span>) */
function labelOf(button: HTMLElement): HTMLElement {
  const spans = [...button.querySelectorAll<HTMLElement>("span")].filter(
    (el) => el.children.length === 0 && el.textContent?.trim(),
  );
  return spans[0] ?? button;
}

export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType !== "product") return;
  const product = readPageProduct();
  const ids = new Set((product?.preorder ?? []).map(String));
  if (!product || ids.size === 0) return;
  const tag = s.onlyTag.toLowerCase();
  if (tag && !(product.tags ?? []).some((t) => t.toLowerCase() === tag)) return;
  const form = productForm();
  const button = form?.querySelector<HTMLElement>('[name="add"], [type="submit"]');
  if (!form || !button) return;

  const text = preorderText(s, config.locale);
  const property = document.createElement("input");
  property.type = "hidden";
  property.name = `properties[${widgetT(config.locale, "preorderLine")}]`;
  property.value = text;
  // Shop Pay-র মতো দ্রুত বাটন লাইনের property রাখে না, তাই প্রি-অর্ডারে লুকানো
  const style = document.createElement("style");
  style.textContent = ".shopify-payment-button{display:none!important}";
  let host: HTMLElement | null = null;
  let original: string | null = null;
  let active = false;
  let viewed = false;

  const apply = () => {
    const on = ids.has(currentVariantId(product.variantId));
    const label = labelOf(button);
    if (on) {
      if (label.textContent !== s.buttonText) {
        original = label.textContent;
        label.textContent = s.buttonText;
      }
    } else if (active && original !== null && label.textContent === s.buttonText) {
      label.textContent = original;
    }
    if (on === active) return;
    active = on;
    if (on) {
      form.append(property);
      document.head.append(style);
      host = host ?? placeAfterProductForm(TOOL_ID);
      host.hidden = false;
      host.innerHTML = "";
      const p = document.createElement("p");
      p.textContent = text;
      p.style.cssText = `margin:12px 0;padding:10px 14px;border-radius:8px;font-weight:600;background:${s.colors.background};color:${s.colors.text};border:1px solid ${s.colors.accent}`;
      host.append(p);
      if (!viewed) {
        viewed = true;
        track(TOOL_ID, "view");
      }
    } else {
      property.remove();
      style.remove();
      if (host) host.hidden = true;
    }
  };

  apply();
  onVariantChange(apply);
  // থিম ভ্যারিয়েন্ট বদলে বাটনের লেখা নিজে বসায় (কখনো দেরিতে), তখন আবার ঠিক করি
  new MutationObserver(() => {
    if (active && labelOf(button).textContent !== s.buttonText) apply();
  }).observe(button, { childList: true, characterData: true, subtree: true });
  form.addEventListener("submit", () => {
    if (active) track(TOOL_ID, "add_to_cart");
  });
}
