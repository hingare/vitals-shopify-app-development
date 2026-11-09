import type { ToolContext } from "../types";
import { widgetT } from "../i18n";
import { attribute, track } from "../analytics";
import { QUIET_ADD_PATH } from "../cart-api";
import { productForm, root } from "../product";

const TOOL_ID = "accelerated-checkout";

interface Settings {
  buyNowButton: boolean;
  buttonText: string;
  skipCart: boolean;
  colors: { background: string; text: string; accent: string };
}

/** প্রোডাক্ট ফর্মের সব তথ্য (ভ্যারিয়েন্ট, পরিমাণ, কাস্টম অপশন) কার্টে যোগ করে সোজা চেকআউটে */
async function toCheckout(form: HTMLFormElement, error: HTMLElement, locale: string) {
  if (!form.reportValidity()) return false;
  // quiet: Cart Drawer যেন এক মুহূর্তের জন্য খুলে না যায়
  const res = await fetch(`${root()}${QUIET_ADD_PATH}`, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: new FormData(form),
  }).catch(() => null);
  if (!res?.ok) {
    const body = (await res?.json().catch(() => null)) as { description?: string } | null;
    error.textContent = body?.description || widgetT(locale, "addFailed");
    error.hidden = false;
    return false;
  }
  track(TOOL_ID, "add_to_cart");
  await attribute(TOOL_ID);
  location.href = `${root()}checkout`;
  return true;
}

export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType !== "product") return;
  const form = productForm();
  if (!form) return;

  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  error.hidden = true;
  error.style.cssText = "margin:8px 0 0;color:#B91C1C;font-size:14px";
  let busy = false;
  const go = async (button?: HTMLButtonElement) => {
    if (busy) return;
    busy = true;
    error.hidden = true;
    if (button) button.setAttribute("aria-busy", "true");
    const ok = await toCheckout(form, error, config.locale);
    if (!ok) {
      busy = false;
      button?.removeAttribute("aria-busy");
    }
  };

  if (s.buyNowButton) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.appWidget = TOOL_ID;
    button.textContent = s.buttonText;
    button.style.cssText = `display:block;width:100%;margin-top:10px;padding:14px 16px;border:0;border-radius:6px;cursor:pointer;font:inherit;font-weight:700;background:${s.colors.accent};color:#fff`;
    button.addEventListener("click", () => {
      track(TOOL_ID, "click");
      void go(button);
    });
    const submit = form.querySelector<HTMLElement>('[type="submit"], [name="add"]');
    (submit ?? form.lastElementChild ?? form).after(button);
    button.after(error);
  } else {
    form.append(error);
  }

  if (s.skipCart) {
    // capture: থিমের নিজের Ajax কার্ট বা drawer চলার আগেই
    document.addEventListener(
      "submit",
      (e) => {
        if (e.target !== form) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        track(TOOL_ID, "click");
        void go();
      },
      true,
    );
  }
}
