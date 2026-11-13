import type { ToolContext } from "../types";

const BEST = "best-selling";
const MARK = "data-app-bsp";
/** সাজানোর বাকি মানগুলো (Shopify-র নিজের নাম); এগুলোর পাশে থাকলেই বোঝা যায় জিনিসটা সাজানোর তালিকার অংশ */
const OTHER_ORDERS = [
  "manual",
  "price-ascending",
  "price-descending",
  "title-ascending",
  "title-descending",
  "created-ascending",
  "created-descending",
];
/** থিমগুলো সাজানোর পছন্দ এই কয়েক রকমে লেখে: <option value>, <input value>, data-value, বা sort_by সহ লিংক */
const ATTRIBUTES = ["value", "data-value", "data-sort-by", "data-sort", "data-sort-value"];
const choice = (order: string) =>
  [...ATTRIBUTES.map((name) => `[${name}="${order}"]`), `a[href*="sort_by=${order}"]`].join(",");
const BEST_CHOICE = choice(BEST);
const OTHER_CHOICE = OTHER_ORDERS.map(choice).join(",");
/** পছন্দের চারপাশে সর্বোচ্চ কয়টা মোড়ক ধরা হবে (li > div > label > input পর্যন্ত) */
const MAX_DEPTH = 4;

interface Settings {
  hideSortOption: boolean;
  redirectVisits: boolean;
}

declare global {
  interface Window {
    /** পেজ best-selling ক্রমে থাকলে সাধারণ ক্রমে পাঠায়; app embed-এর Liquid এটা বসায় (পাঠানো চালু থাকলে) */
    __APP_BSP__?: () => void;
  }
}

/** ঠিকানার ?... অংশে sort_by=best-selling আছে কিনা, অর্থাৎ পেজ এখন ওই ক্রমে সাজানো */
export const showsBestSelling = (search: string) =>
  new URLSearchParams(search).getAll("sort_by").includes(BEST);

/** সাইটের মূল মেনুর (হেডার বা ফুটার) লিংক সাজানোর তালিকা নয়; মার্চেন্ট নিজে সেখানে লিংক রাখলে তা থাকে */
function inSiteMenu(el: Element): boolean {
  const bar = el.closest("header, footer");
  return bar !== null && !bar.closest("main, [role=main]");
}

/** n ধাপ ওপরের মোড়ক */
function nthParent(el: Element, n: number): Element | null {
  let node: Element | null = el;
  for (let i = 0; i < n && node; i++) node = node.parentElement;
  return node;
}

/**
 * পছন্দটা যে মোড়কসহ লুকাতে হবে (যেমন তার <li>)। সাজানোর তালিকা চেনার উপায়: পাশাপাশি একই রকম মোড়কে,
 * একই গভীরতায়, সাজানোর অন্য পছন্দ থাকে (<option>-এর পাশে <option>, <li><a>-র পাশে <li><a>)।
 * তেমন কিছু না থাকলে null: তখন এটা সাজানোর তালিকা নয় (যেমন "best-selling" নামের ট্যাগের ফিল্টার,
 * বা পেজের কোথাও বসানো একটা লিংক), তাই ছোঁয়া হয় না।
 */
function choiceBox(el: Element): Element | null {
  let box = el;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const parent = box.parentElement;
    if (!parent) return null;
    for (const sibling of parent.children) {
      if (sibling === box || sibling.tagName !== box.tagName) continue;
      const others =
        depth === 0
          ? sibling.matches(OTHER_CHOICE)
            ? [sibling]
            : []
          : sibling.querySelectorAll(OTHER_CHOICE);
      for (const other of others) {
        if (nthParent(other, depth) === sibling) return box;
      }
    }
    box = parent;
  }
  return null;
}

/** এই মুহূর্তে বাছাই করা পছন্দ লুকানো হয় না, নইলে মেনু ভুল ক্রম দেখাত */
const isCurrent = (el: Element) =>
  (el instanceof HTMLOptionElement && el.selected) ||
  (el instanceof HTMLInputElement && el.checked);

function hideChoices() {
  for (const el of document.querySelectorAll(BEST_CHOICE)) {
    if (el.hasAttribute(MARK) || el.closest(`[${MARK}]`) || isCurrent(el)) continue;
    if (el instanceof HTMLAnchorElement && inSiteMenu(el)) continue;
    const box = choiceBox(el);
    if (!box) continue;
    // <option> CSS দিয়ে লুকালে Safari মানে না, তাই সরিয়ে ফেলা হয়
    if (box instanceof HTMLOptionElement || box instanceof HTMLOptGroupElement) {
      box.remove();
      continue;
    }
    box.setAttribute(MARK, "");
    // মোড়কের বাইরে আলাদা বসা <label for="..."> থাকলে সেটাও
    if (el instanceof HTMLInputElement) {
      for (const label of el.labels ?? []) label.setAttribute(MARK, "");
    }
  }
}

/**
 * কালেকশন পেজে "Best selling" ক্রম আড়াল করে: সাজানোর মেনু থেকে পছন্দটা সরায়। কেউ সরাসরি
 * ?sort_by=best-selling লিংকে এলে সাধারণ ক্রমে পাঠানোর কাজটা app embed-এর Liquid করে (লোডারের আগেই,
 * যাতে তালিকাটা কম সময় চোখে পড়ে); থিম পেজ নতুন করে লোড না করে ক্রম বদলালে এখান থেকে সেটাকেই ডাকা হয়।
 *
 * মার্চেন্ট নিজেই কোনো কালেকশনের মূল ক্রম "Best selling" রাখলে সেখানে কিছু করা হয় না:
 * ওই ক্রম তিনি নিজে প্রকাশ্য করেছেন, আর পছন্দটা সরালে ক্রেতা মূল ক্রমে ফিরতে পারতেন না।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType !== "collection" || config.defaultSort === BEST) return;
  // পাঠানো চালু থাকলে মেনুর পছন্দটাও সরে, নইলে সেটা এমন বাটন হতো যা কাজ করে না
  if (!s.hideSortOption && !s.redirectVisits) return;

  const check = () => {
    if (!showsBestSelling(location.search)) return hideChoices();
    // পেজ এখন best-selling ক্রমেই আছে: পাঠানো চালু থাকলে সরাও, নইলে মেনু যেমন আছে থাকুক
    if (s.redirectVisits) window.__APP_BSP__?.();
  };

  const style = document.createElement("style");
  style.textContent = `[${MARK}]{display:none!important}`;
  document.head.appendChild(style);
  check();

  // থিম পরে মেনু বসালে বা নতুন করে আঁকলে (ফিল্টার বদল, মোবাইলের ড্রয়ার) আবার দেখা হয়
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      check();
    });
  }).observe(document.body, { childList: true, subtree: true });
}
