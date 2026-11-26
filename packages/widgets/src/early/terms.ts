/**
 * Agree to Terms: চেকআউট বাটনের আগে টিকবক্স (কার্ট পেজ আর কার্ট ড্রয়ার দুটোতেই); টিক না দিলে
 * চেকআউটে যাওয়া যায় না। early.ts এটা <head>-এ চালু করে, তাই থিমের HTML পড়ার সময় বাটন এলেই বক্স
 * বসে যায় (পাতা আঁকার আগে); টুলের ফাইল পরে এলে দেখে যে চালু হয়ে গেছে।
 */
import { h } from "./h";

export interface TermsSettings {
  checkboxText: string;
  linkText: string;
  termsUrl: string;
  errorText: string;
  colors: { background: string; text: string; accent: string };
}

const CHECKOUT = '[name="checkout"], a[href$="/checkout"], button[form][name="checkout"]';

export function setupTerms(s: TermsSettings) {
  if (window.__APP_TERMS__) return;
  window.__APP_TERMS__ = true;
  let agreed = false;

  const errors = (hidden: boolean) => {
    for (const e of document.querySelectorAll<HTMLElement>(".app-terms-error")) e.hidden = hidden;
  };

  const addBox = (button: HTMLElement) => {
    if (button.dataset.appTerms) return;
    button.dataset.appTerms = "1";
    const input = h("input", "width:18px;height:18px;margin:2px 0 0;flex:none", {
      type: "checkbox",
    });
    input.checked = agreed;
    input.addEventListener("change", () => {
      agreed = input.checked;
      for (const other of document.querySelectorAll<HTMLInputElement>(".app-terms input")) {
        other.checked = agreed;
      }
      if (agreed) errors(true);
    });
    const [before = "", after = ""] = s.checkboxText.split("{terms}");
    const text = h("span", "", {}, before);
    if (s.checkboxText.includes("{terms}")) {
      text.append(
        h(
          "a",
          "color:inherit",
          { href: s.termsUrl, target: "_blank", rel: "noopener" },
          s.linkText,
        ),
        after,
      );
    }
    const error = h(
      "p",
      `margin:6px 0 0;color:${s.colors.accent}`,
      {
        class: "app-terms-error",
        role: "alert",
      },
      s.errorText,
    );
    error.hidden = true;
    button.before(
      h(
        "div",
        `margin:10px 0;font-size:14px;color:${s.colors.text};text-align:left`,
        { class: "app-terms" },
        h("label", "display:flex;gap:8px;align-items:flex-start;cursor:pointer", {}, input, text),
        error,
      ),
    );
  };

  const scan = () => {
    for (const button of document.querySelectorAll<HTMLElement>(CHECKOUT)) addBox(button);
  };
  scan();
  // থিমের HTML পড়ার সময় আর পরে কার্ট ড্রয়ার খুললেও বাটন এলেই বক্স বসে
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });

  const block = (event: Event) => {
    const target = (event.target as Element | null)?.closest?.(CHECKOUT);
    const isCheckoutSubmit =
      event.type === "submit" &&
      (event as SubmitEvent).submitter?.getAttribute("name") === "checkout";
    if ((!target && !isCheckoutSubmit) || agreed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    errors(false);
    document.querySelector<HTMLInputElement>(".app-terms input")?.focus();
  };
  document.addEventListener("click", block, true);
  document.addEventListener("submit", block, true);
}
