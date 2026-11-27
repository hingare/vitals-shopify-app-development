import { crc32, deflateSync } from "node:zlib";
import type { PageKind } from "./store";

/**
 * নকল দোকানকে সাধারণ একটা Dawn দোকানের মতো ভারী করা (StoreOptions.weight, শুধু গতির পরীক্ষায়:
 * e2e/speed.ts)। হালকা পাতায় Lighthouse-এর স্কোর ১০০-তে আটকে থাকে, তাই আমাদের টুলের খরচ স্কোরে
 * দেখা যায় না। আসল দোকানে থাকে থিমের CSS আর JS, Shopify-র নিজের স্ক্রিপ্ট (analytics, pixels, Shop Pay)
 * আর বড় ছবি, আর Shopify-র সার্ভার পাতা বানাতে কিছুটা সময় নেয়। এখানে সেগুলোর আনুমানিক মাপের নকল ফাইল:
 * সব সময় একই ফাইল (একই বীজের এলোমেলো সংখ্যা), যাতে প্রতিবার একই পাতা মাপা হয়।
 *
 * লক্ষ্য: টুল ছাড়া মোবাইল স্কোর মোটামুটি ৮০-র ঘরে, যেমন একটা সাধারণ Dawn দোকানে দেখা যায়।
 */

/** Shopify-র সার্ভারে পাতা বানানোর সময় (Liquid) */
export const SERVER_MS = 150;

/** একই বীজে সবসময় একই সংখ্যা */
function random(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return x / 4294967296;
  };
}

/**
 * ছবি: রঙের ঢাল আর তার ওপর এলোমেলো দানা, যাতে আসল ছবির মতো চাপা যায় না। noiseBits দিয়ে ফাইলের
 * আকার ঠিক হয় (প্রতি পিক্সেলে মোটামুটি ততগুলো বিট)। ছবির আসল মাপ দেখানো মাপের সমান বা বড়, কারণ
 * Chrome ছোট ছবি টেনে বড় দেখালে LCP-তে আসল মাপটাই ধরে।
 */
function png(width: number, height: number, noiseBits: number, seed: number): Buffer {
  const rand = random(seed);
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  const mask = (1 << noiseBits) - 1;
  let previous = Buffer.alloc(width * 3);
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x++) {
      row[x * 3] = Math.floor((x / width) * 200) + 30;
      row[x * 3 + 1] = Math.floor((y / height) * 160) + 60;
      row[x * 3 + 2] = (170 & ~mask) | (Math.floor(rand() * 256) & mask);
    }
    // PNG-এর "Up" ফিল্টার: আগের সারির সাথে পার্থক্য, আসল ছবির মতো চাপা যায়
    raw[y * stride] = 2;
    for (let i = 0; i < row.length; i++) raw[y * stride + 1 + i] = (row[i]! - previous[i]!) & 255;
    previous = row;
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // বিট
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const PROPS = [
  "margin",
  "padding",
  "color",
  "background-color",
  "border-radius",
  "font-size",
  "line-height",
  "letter-spacing",
  "gap",
  "max-width",
  "transition",
  "box-shadow",
];

/** থিমের CSS: আসল থিমের মতো অনেক নিয়ম, যার বেশিরভাগ এই পাতায় কাজে লাগে না */
function css(bytes: number, seed: number): string {
  const rand = random(seed);
  const n = (max: number) => Math.floor(rand() * max);
  const value = (prop: string) => {
    if (prop.includes("color")) return `#${n(0xffffff).toString(16).padStart(6, "0")}`;
    if (prop === "transition") return `opacity ${n(900)}ms ease,transform ${n(900)}ms ease`;
    if (prop === "box-shadow") return `0 ${n(20)}px ${n(40)}px rgba(0,0,0,.${n(99)})`;
    return `${n(64)}px ${n(64)}px`;
  };
  const parts: string[] = [];
  let size = 0;
  for (let i = 0; size < bytes; i++) {
    const rules = Array.from({ length: 1 + n(5) }, () => {
      const prop = PROPS[n(PROPS.length)]!;
      return `${prop}:${value(prop)}`;
    });
    const rule = `.t${i.toString(36)} .e${n(9999).toString(36)}>.c${n(999)}{${rules.join(";")}}\n`;
    parts.push(rule);
    size += rule.length;
  }
  return parts.join("");
}

/**
 * জাভাস্ক্রিপ্ট: অনেক ফাংশন (ব্রাউজার পড়ে আর বোঝে, কিন্তু সব চালায় না), আর কিছু কাজ যা পাতা আসার
 * সময় চলে, যেমন থিম বা Shopify-র analytics চালায়। কাজের পরিমাণ ঘোরার সংখ্যায়, সময়ে নয়, যাতে
 * ধীর কম্পিউটারে আসল কোডের মতোই বেশি সময় লাগে।
 */
type When = "now" | "DOMContentLoaded" | "load" | "later";

function script(bytes: number, seed: number, work: Array<[when: When, loops: number]>): string {
  const rand = random(seed);
  const n = (max: number) => Math.floor(rand() * max);
  const parts = [
    "(function(){var w=function(n){for(var a=0,i=0;i<n;i++)a=(a*31+i)%1000003;return a},r={};",
  ];
  let size = parts[0]!.length;
  for (let i = 0; size < bytes; i++) {
    // "_" দিয়ে শুরু, যাতে নাম কখনো for/if-এর মতো শব্দ না হয়
    const name = `_${i.toString(36)}`;
    const body = `function ${name}(a,b){var c=a*${n(9999)}+b-${n(9999)};if(c>${n(99999)}){return r.${name}=c%${1 + n(97)}}return "${n(0xffffff).toString(36)}"+c}`;
    parts.push(body);
    size += body.length;
  }
  work.forEach(([when, loops], i) => {
    const run = `r.w${i}=w(${loops})`;
    parts.push(
      when === "now"
        ? `${run};`
        : when === "DOMContentLoaded"
          ? `document.addEventListener("DOMContentLoaded",function(){${run}});`
          : when === "load"
            ? `window.addEventListener("load",function(){${run}});`
            : // পাতা আসার পরে আলাদা কাজ (যেমন web pixels চালু হওয়া)
              `window.addEventListener("load",function(){setTimeout(function(){${run}},${50 * (i + 1)})});`,
    );
  });
  parts.push("window.__weight=r})();");
  return parts.join("\n");
}

/** চাপা যায় না এমন বাইট */
function noise(bytes: number, seed: number): Buffer {
  const rand = random(seed);
  return Buffer.from(Array.from({ length: bytes }, () => Math.floor(rand() * 256)));
}

interface Asset {
  contentType: string;
  body: () => string | Buffer;
}

const once = (make: () => string | Buffer) => {
  let value: string | Buffer | null = null;
  return () => (value ??= make());
};

/** ভারী দোকানের ফাইলগুলো: পথ → ফাইল */
export const WEIGHT_ASSETS: Record<string, Asset> = {
  // Dawn-এর base.css আর component-*.css মিলিয়ে, পাতা আঁকার আগে লাগে
  "/cdn/theme/base.css": { contentType: "text/css", body: once(() => css(90_000, 1)) },
  // Dawn-এর global.js, product-form.js ইত্যাদি (defer)
  "/cdn/theme/global.js": {
    contentType: "application/javascript",
    body: once(() =>
      script(70_000, 2, [
        ["DOMContentLoaded", 2_200_000],
        ["load", 1_600_000],
      ]),
    ),
  },
  // content_for_header: Shopify-র analytics (trekkie), web pixels, consent ইত্যাদি (async)
  "/cdn/platform/storefront.js": {
    contentType: "application/javascript",
    body: once(() =>
      script(270_000, 3, [
        ["now", 1_600_000],
        ["load", 2_600_000],
        ["later", 2_200_000],
        ["later", 2_200_000],
      ]),
    ),
  },
  // প্রোডাক্ট পাতায় Shop Pay বাটন আর কিস্তির লেখা
  "/cdn/platform/shop-pay.js": {
    contentType: "application/javascript",
    body: once(() => script(190_000, 4, [["now", 1_600_000]])),
  },
  // থিমের দুটো ফন্ট, আগেভাগে আনা হয় (preload)। ভেতরে আসল ফন্ট নেই, শুধু আকারটা আসলের মতো;
  // font-display: swap, তাই লেখা আগেই সাধারণ ফন্টে দেখা যায়
  "/cdn/theme/body.woff2": { contentType: "font/woff2", body: once(() => noise(26_000, 11)) },
  "/cdn/theme/heading.woff2": { contentType: "font/woff2", body: once(() => noise(22_000, 12)) },
  "/cdn/shop/hero.png": { contentType: "image/png", body: once(() => png(1000, 400, 1, 5)) },
  "/cdn/shop/cotton-tee.png": { contentType: "image/png", body: once(() => png(600, 600, 1, 6)) },
  "/cdn/shop/coffee-mug.png": { contentType: "image/png", body: once(() => png(400, 400, 1, 7)) },
  "/cdn/shop/canvas-cap.png": { contentType: "image/png", body: once(() => png(400, 400, 1, 8)) },
  "/cdn/shop/wool-socks.png": { contentType: "image/png", body: once(() => png(400, 400, 1, 9)) },
};

/** <head>-এ: থিমের স্টাইল আর স্ক্রিপ্ট, Shopify-র content_for_header-এর স্ক্রিপ্ট */
export function weightHead(kind: PageKind): string {
  return `
  <link rel="preload" as="font" href="/cdn/theme/body.woff2" type="font/woff2" crossorigin>
  <link rel="preload" as="font" href="/cdn/theme/heading.woff2" type="font/woff2" crossorigin>
  <script src="/cdn/theme/global.js" defer></script>
  <script async src="/cdn/platform/storefront.js"></script>
  ${kind === "product" ? '<script async src="/cdn/platform/shop-pay.js"></script>' : ""}
  <link rel="stylesheet" href="/cdn/theme/base.css">
  <style>
    @font-face { font-family: "Body"; src: url("/cdn/theme/body.woff2") format("woff2"); font-display: swap; }
    @font-face { font-family: "Heading"; src: url("/cdn/theme/heading.woff2") format("woff2"); font-display: swap; }
    body { font-family: "Body", system-ui, sans-serif; }
    h1, h2, h3 { font-family: "Heading", system-ui, sans-serif; }
    .banner img { display: block; width: 100%; height: auto; }
    .mega { position: absolute; left: -9999px; }
    .footer-links { columns: 2; }
  </style>`;
}

/** থিমের JSON-এর কতগুলো জিনিস চাপা অবস্থায় মোটামুটি ১KB (মেপে দেখা) */
const ENTRIES_PER_KB = 32;

/** হোম পাতার বড় ছবি (পাতার সবচেয়ে বড় জিনিস, LCP) */
export const HERO = `
      <div class="banner"><img src="/cdn/shop/hero.png" alt="New season clothes" width="1000" height="400" fetchpriority="high"></div>`;

/**
 * মেনু (মোবাইল আর ডেস্কটপের আলাদা), দেশ বাছার তালিকা, আইকন আর থিমের নিজের JSON (ভ্যারিয়েন্ট, অনুবাদ):
 * আসল Dawn পাতার HTML চাপার পরেও ৩০KB-র মতো, তাই এখানেও তাই।
 *
 * আকারটা গুরুত্বপূর্ণ: Lighthouse নতুন সংযোগের ধীরে শুরু হওয়া (TCP slow start) হিসাব করে, প্রতি round trip-এ
 * আগের দ্বিগুণ বাইট। পাতার HTML আর CSS মিলিয়ে ঠিক কোনো round trip-এর সীমার নিচে থাকলে যে কেউ কয়েক KB
 * যোগ করলেই CSS আরেক round trip (~১৫০ms) পরে আসে আর প্রথম আঁকা পিছিয়ে যায়। আগে এই নকল পাতা (২০KB)
 * ঠিক সেই কিনারায় ছিল, তাই app embed যা-ই যোগ করুক, প্রথম আঁকা ~১৪০ms পেছাত; আসল দোকানে সেটা
 * পাতার আকারের ওপর নির্ভর করে। আমাদের HTML-এ যোগ করা বাইটের আলাদা সীমা আছে (e2e/speed.ts)।
 * একই কারণে পরের ফাইলগুলোও (ফন্ট, ছবি) এক round trip আগে-পরে আসতে পারে, তাই গতির পরীক্ষা প্রতি জোড়ায়
 * পাতার আকার বদলায়: extraKb দিলে থিমের JSON-এ মোটামুটি ততটা KB (চাপা অবস্থায়) বেশি।
 */
export function weightChrome(extraKb = 0): { menu: string; footer: string } {
  const rand = random(10);
  const n = (max: number) => Math.floor(rand() * max);
  const slug = () => n(0x7fffffff).toString(36);
  const links = (count: number) =>
    Array.from(
      { length: count },
      () =>
        `<li><a href="/collections/${slug()}-${slug()}" class="menu__item">${slug()} ${slug()}</a></li>`,
    ).join("");
  const icon = () =>
    `<svg aria-hidden="true" focusable="false" class="icon icon-${slug()}" width="20" height="20" viewBox="0 0 20 20"><path d="M${n(20)}.${n(99)} ${n(20)}.${n(99)}c${n(9)}.${n(99)} ${n(9)}.${n(99)} ${n(20)}-${n(9)}.${n(9)}l${n(9)}.${n(9)} ${n(9)}.${n(9)}H${n(20)}.${n(99)}V${n(20)}z" fill="currentColor"/></svg>`;
  const countries = Array.from(
    { length: 240 },
    () =>
      `<li><a href="#" data-value="${slug().slice(0, 2).toUpperCase()}" class="localization-form__list-item"><span class="localization-form__list-item-text">${slug()} ${slug()}</span><span class="localization-form__currency">${slug().slice(0, 3).toUpperCase()} ${"$€£৳"[n(4)]}</span></a></li>`,
  ).join("");
  const data = Array.from({ length: 560 + Math.round(extraKb * ENTRIES_PER_KB) }, () => ({
    id: n(1e12),
    key: slug(),
    text: `${slug()} ${slug()} ${slug()}`,
    price: n(99999),
  }));
  const menu = Array.from({ length: 8 }, () => `<ul>${links(14)}</ul>`).join("");
  return {
    menu: `<div class="mega">${menu}${menu.replaceAll("menu__item", "menu-drawer__item")}${Array.from({ length: 60 }, icon).join("")}</div>`,
    footer: `<ul class="footer-links">${links(40)}</ul><div class="mega"><ul class="localization-form__list">${countries}</ul></div><script type="application/json" id="theme-data">${JSON.stringify(data)}</script>`,
  };
}
