import type { ToolContext } from "../types";

interface Settings {
  checkboxText: string;
  linkText: string;
  termsUrl: string;
  errorText: string;
  colors: { background: string; text: string; accent: string };
}

const CHECKOUT = '[name="checkout"], a[href$="/checkout"], button[form][name="checkout"]';
let agreed = false;

/** চেকআউট বাটনের আগে টিকবক্স (কার্ট পেজ আর কার্ট ড্রয়ার দুটোতেই) */
function addBox(button: HTMLElement, s: Settings) {
  if (button.dataset.appTerms) return;
  button.dataset.appTerms = "1";
  const box = document.createElement("div");
  box.className = "app-terms";
  box.style.cssText = `margin:10px 0;font-size:14px;color:${s.colors.text};text-align:left`;
  const label = document.createElement("label");
  label.style.cssText = "display:flex;gap:8px;align-items:flex-start;cursor:pointer";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = agreed;
  input.style.cssText = "width:18px;height:18px;margin:2px 0 0;flex:none";
  input.addEventListener("change", () => {
    agreed = input.checked;
    for (const other of document.querySelectorAll<HTMLInputElement>(".app-terms input")) {
      other.checked = agreed;
    }
    if (agreed)
      for (const e of document.querySelectorAll<HTMLElement>(".app-terms-error")) e.hidden = true;
  });
  const text = document.createElement("span");
  const [before, after = ""] = s.checkboxText.split("{terms}");
  text.append(before ?? "");
  if (s.checkboxText.includes("{terms}")) {
    const a = document.createElement("a");
    a.href = s.termsUrl;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = s.linkText;
    a.style.color = "inherit";
    text.append(a, after);
  }
  label.append(input, text);
  const error = document.createElement("p");
  error.className = "app-terms-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  error.textContent = s.errorText;
  error.style.cssText = `margin:6px 0 0;color:${s.colors.accent}`;
  box.append(label, error);
  button.before(box);
}

export function mount({ settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const scan = () => {
    for (const button of document.querySelectorAll<HTMLElement>(CHECKOUT)) addBox(button, s);
  };
  scan();
  // কার্ট ড্রয়ার পরে খুললেও বক্স বসে
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });

  const block = (event: Event) => {
    const target = (event.target as Element | null)?.closest?.(CHECKOUT);
    const isCheckoutSubmit =
      event.type === "submit" &&
      (event as SubmitEvent).submitter?.getAttribute("name") === "checkout";
    if ((!target && !isCheckoutSubmit) || agreed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    for (const e of document.querySelectorAll<HTMLElement>(".app-terms-error")) e.hidden = false;
    document.querySelector<HTMLInputElement>(".app-terms input")?.focus();
  };
  document.addEventListener("click", block, true);
  document.addEventListener("submit", block, true);
}
