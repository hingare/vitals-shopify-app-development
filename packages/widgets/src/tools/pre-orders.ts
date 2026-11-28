import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { track } from "../analytics";
import { adopt } from "../early/run";
import { submitOf } from "../early/buy-now";
import {
  type PreorderSettings,
  buildPreorder,
  hideFastCheckout,
  labelOf,
  preorderIds,
  preorderLabel,
  preorderText,
} from "../early/preorder";
import {
  currentVariantId,
  onVariantChange,
  placeAfterProductForm,
  productForm,
  readPageProduct,
} from "../product";

const TOOL_ID = "pre-orders";

export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as PreorderSettings;
  if (config.pageType !== "product") return;
  const product = readPageProduct();
  const ids = product ? preorderIds(s, product) : new Set<string>();
  if (!product || ids.size === 0) return;
  const form = productForm();
  const button = form && submitOf(form);
  if (!form || !button) return;

  const text = preorderText(s, config.locale);
  const property = document.createElement("input");
  property.type = "hidden";
  property.name = `properties[${widgetT(config.locale, "preorderLine")}]`;
  property.value = text;
  const style = hideFastCheckout();
  // early.ts পাতা আঁকার আগে বার্তা, বাটনের লেখা আর style বসিয়ে থাকলে সেগুলোই (null: এখনো কিছু মেলানো হয়নি)
  let host = adopt(TOOL_ID);
  let active: boolean | null = null;
  let viewed = false;

  const apply = () => {
    const on = ids.has(currentVariantId(product.variantId));
    const label = labelOf(button);
    if (on) preorderLabel(button, s.buttonText);
    else if (label.dataset.appText !== undefined && label.textContent === s.buttonText) {
      label.textContent = label.dataset.appText;
    }
    if (on === active) return;
    active = on;
    if (on) {
      form.append(property);
      document.head.append(style);
      host = host ?? placeAfterProductForm(TOOL_ID);
      host.hidden = false;
      host.replaceChildren(buildPreorder(s, text));
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
