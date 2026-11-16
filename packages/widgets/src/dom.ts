/** ছোট DOM সাহায্যকারী */
export const isMobile = () => window.matchMedia("(max-width: 749px)").matches;

/** "{n} left" → "3 left" */
export function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/**
 * উপরে বা নিচে বারের জায়গা। একাধিক বার (ঘোষণা, স্পেন্ডিং গোল) একটার নিচে আরেকটা বসে, একে অন্যকে ঢাকে না।
 * উপরের বার পেজের শুরুতে বসে (কনটেন্ট নিচে সরে); নিচেরটা স্ক্রিনে আটকে থাকে।
 */
const BAR_ORDER = ["announcement-bar", "spending-goal"];

export function barHost(position: "top" | "bottom", name: string, sticky = false): HTMLElement {
  const id = `app-bars-${position}`;
  let stack = document.getElementById(id);
  if (!stack) {
    stack = document.createElement("div");
    stack.id = id;
    if (position === "top") document.body.prepend(stack);
    else {
      stack.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147482000";
      document.body.appendChild(stack);
    }
  }
  if (position === "top" && sticky) {
    stack.style.cssText = "position:sticky;top:0;z-index:2147482000";
  }
  const host = document.createElement("div");
  host.dataset.appWidget = name;
  const rank = (n?: string) => BAR_ORDER.indexOf(n ?? "") + 1 || 99;
  const next = [...stack.children].find(
    (child) => rank((child as HTMLElement).dataset.appWidget) > rank(name),
  );
  stack.insertBefore(host, next ?? null);
  return host;
}

/** স্ক্রিনের নিচে আমাদের অন্য কিছু (Sticky ATC, নিচের বার) থাকলে তার উচ্চতা */
export function bottomOffset(): number {
  let height = 0;
  for (const el of document.querySelectorAll<HTMLElement>(
    "#app-sticky-atc > *, #app-bars-bottom",
  )) {
    height = Math.max(height, el.offsetHeight);
  }
  return height;
}

/**
 * স্টোরের ফুটারে আমাদের লিংকের সারি (Order Tracker, EU Withdrawal)। থিমের ফুটার না পেলে পেজের শেষে বসে।
 * লেখার রঙ আর ফন্ট ফুটার থেকেই আসে, তাই থিমের সাথে মিলে যায়।
 */
export function footerLink(name: string, text: string, href: string): HTMLAnchorElement {
  let row = document.getElementById("app-footer-links");
  if (!row) {
    row = document.createElement("div");
    row.id = "app-footer-links";
    row.style.cssText =
      "display:flex;flex-wrap:wrap;gap:8px 20px;justify-content:center;padding:12px 16px;font-size:14px";
    // পোস্ট বা কার্ডের ভেতরের <footer> নয়, পেজের আসল ফুটার
    const footers = [
      ...document.querySelectorAll<HTMLElement>('footer, [role="contentinfo"]'),
    ].filter((el) => !el.closest("main, article, dialog, [role=dialog]"));
    (footers[footers.length - 1] ?? document.body).appendChild(row);
  }
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text;
  link.dataset.appWidget = name;
  link.style.cssText = "color:inherit;text-decoration:underline";
  row.appendChild(link);
  return link;
}

export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private mode
    }
  },
};

/** sessionStorage (শুধু এই ট্যাবের এই ভিজিট); বন্ধ থাকলে চুপচাপ কিছু না */
export const sessionStore = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // private mode
    }
  },
};
