import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import { buildStoreConfig, registry } from "@app/tools";

/**
 * পরীক্ষার জন্য নকল Shopify দোকান: Dawn-এর মতো একটা পাতা, Shopify-র Ajax API (/cart.js,
 * /products/x.js ...) আর আমাদের App Proxy-র (/apps/app-tools/*) নকল উত্তর। উইজেটগুলো চলে আসল
 * বিল্ড করা ফাইল থেকে (theme-embed/assets), ঠিক যেমন দোকানে চলে। ইন্টারনেট বা আসল দোকান লাগে না।
 */
export const ORIGIN = "https://shop.test";
const ASSETS = fileURLToPath(
  new URL("../../../apps/admin/extensions/theme-embed/assets/", import.meta.url),
);

export type PageKind = "product" | "cart" | "collection" | "index";

export interface Variant {
  id: number;
  title: string;
  price: number;
  available: boolean;
}

export interface Product {
  id: number;
  handle: string;
  title: string;
  price: number;
  compareAt: number | null;
  tags: string[];
  variants: Variant[];
}

export const PRODUCTS: Product[] = [
  {
    id: 1001,
    handle: "cotton-tee",
    title: "Cotton tee",
    price: 2500,
    compareAt: 3000,
    tags: ["new", "summer"],
    variants: [
      { id: 111, title: "Small", price: 2500, available: true },
      { id: 112, title: "Large", price: 2500, available: false },
    ],
  },
  {
    id: 1002,
    handle: "coffee-mug",
    title: "Coffee mug",
    price: 1200,
    compareAt: null,
    tags: [],
    variants: [{ id: 221, title: "Default Title", price: 1200, available: true }],
  },
  {
    id: 1003,
    handle: "canvas-cap",
    title: "Canvas cap",
    price: 1800,
    compareAt: null,
    tags: [],
    variants: [{ id: 331, title: "Default Title", price: 1800, available: true }],
  },
  {
    id: 1004,
    handle: "wool-socks",
    title: "Wool socks",
    price: 900,
    compareAt: null,
    tags: [],
    variants: [{ id: 441, title: "Default Title", price: 900, available: true }],
  },
];
const TEE = PRODUCTS[0]!;

const byVariant = (id: number) =>
  PRODUCTS.flatMap((p) => p.variants.map((v) => ({ product: p, variant: v }))).find(
    (x) => x.variant.id === id,
  );

/** Shopify-র /products/x.js-এর মতো */
function ajaxProduct(p: Product) {
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    url: `/products/${p.handle}`,
    price: p.price,
    compare_at_price: p.compareAt,
    available: p.variants.some((v) => v.available),
    featured_image: `//shop.test/cdn/shop/${p.handle}.png`,
    images: [`//shop.test/cdn/shop/${p.handle}.png`],
    tags: p.tags,
    created_at: "2026-11-20T10:00:00+06:00",
    variants: p.variants.map((v) => ({ ...v, name: `${p.title} - ${v.title}` })),
  };
}

interface Line {
  variant_id: number;
  quantity: number;
  properties?: Record<string, string> | null;
}

/** দোকানের কার্ট (প্রতিটা পরীক্ষায় নতুন) */
class Cart {
  lines: Line[] = [];
  attributes: Record<string, string> = {};
  note = "";

  json() {
    const items = this.lines.map((line, i) => {
      const found = byVariant(line.variant_id)!;
      const total = found.variant.price * line.quantity;
      return {
        key: `${line.variant_id}:${i}`,
        id: line.variant_id,
        variant_id: line.variant_id,
        product_id: found.product.id,
        product_title: found.product.title,
        variant_title: found.variant.title === "Default Title" ? null : found.variant.title,
        title: found.product.title,
        handle: found.product.handle,
        url: `/products/${found.product.handle}?variant=${line.variant_id}`,
        image: `//shop.test/cdn/shop/${found.product.handle}.png`,
        quantity: line.quantity,
        price: found.variant.price,
        original_line_price: total,
        final_line_price: total,
        line_price: total,
        properties: line.properties ?? null,
        line_level_discount_allocations: [],
      };
    });
    const total = items.reduce((sum, item) => sum + item.final_line_price, 0);
    return {
      token: "cart-token",
      note: this.note,
      attributes: this.attributes,
      items,
      item_count: items.reduce((sum, item) => sum + item.quantity, 0),
      total_price: total,
      items_subtotal_price: total,
      original_total_price: total,
      total_discount: 0,
      currency: "USD",
      requires_shipping: true,
      cart_level_discount_applications: [],
    };
  }

  add(items: Line[]) {
    for (const item of items) {
      if (!byVariant(Number(item.variant_id))) continue;
      const same = this.lines.find((l) => l.variant_id === Number(item.variant_id));
      if (same) same.quantity += Number(item.quantity) || 1;
      else
        this.lines.push({
          variant_id: Number(item.variant_id),
          quantity: Number(item.quantity) || 1,
          properties: item.properties ?? null,
        });
    }
  }

  change(line: number, quantity: number) {
    const index = line - 1;
    if (!this.lines[index]) return;
    if (quantity <= 0) this.lines.splice(index, 1);
    else this.lines[index]!.quantity = quantity;
  }
}

export interface StoreOptions {
  /** চালু টুল; সেটিংস না দিলে ডিফল্ট */
  tools: Array<{ id: string; settings?: Record<string, unknown> }>;
  page?: PageKind;
  /** পাতার প্রোডাক্টের তথ্য বদলানো (যেমন স্টক শেষ) */
  product?: Record<string, unknown>;
  /** অফার (Volume Discounts, Bundles ...) */
  offers?: Record<string, unknown> | null;
  /** শুরুতেই কার্টে যা থাকে */
  cart?: Line[];
  /** localStorage-এ আগে থেকে যা থাকে (যেমন আগে দেখা প্রোডাক্ট) */
  storage?: Record<string, string>;
  /** App Proxy-র কোনো পথের উত্তর বদলানো */
  proxy?: Record<string, unknown>;
  locale?: string;
  country?: string;
}

export interface Store {
  cart: Cart;
  /** দোকানে আমাদের সার্ভারে কোন কোন অনুরোধ গেল ("GET reviews" ...) */
  proxyCalls: string[];
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** App Proxy-র নকল উত্তর: সাধারণ দোকানে যা আসে তার মতো */
function proxyAnswer(path: string, method: string, options: StoreOptions): unknown {
  const key = path.split("?")[0]!;
  if (options.proxy && key in options.proxy) return options.proxy[key];
  switch (key) {
    case "reviews":
      return {
        summary: { average: 4.5, count: 2, distribution: [1, 1, 0, 0, 0] },
        page: 1,
        hasMore: false,
        reviews: [
          {
            id: "r1",
            rating: 5,
            title: "Lovely tee",
            body: "Soft fabric and it fits well.",
            authorName: "Rahim",
            verified: true,
            reply: null,
            createdAt: "2026-11-01T10:00:00Z",
            images: [],
          },
          {
            id: "r2",
            rating: 4,
            title: null,
            body: "Nice colour.",
            authorName: "Karim",
            verified: false,
            reply: "Thank you!",
            createdAt: "2026-10-20T10:00:00Z",
            images: [],
          },
        ],
      };
    case "recent-sales":
      return {
        sales: [
          {
            title: "Coffee mug",
            url: "/products/coffee-mug",
            image: "//shop.test/cdn/shop/coffee-mug.png",
            soldAt: new Date(Date.now() - 600_000).toISOString(),
          },
        ],
      };
    case "fx":
      return { base: "USD", rates: { USD: 1, EUR: 0.9, GBP: 0.8, BDT: 120 } };
    case "wishlist":
      return { items: [] };
    case "chat":
      // app/lib/chat.server.ts: নতুন ক্রেতার কোনো কথোপকথন নেই
      return { online: true, messages: [], hasEmail: false };
    case "push":
      return method === "GET"
        ? {
            key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
          }
        : { ok: true };
    case "recordings":
      return { ok: false, stop: "test" };
    case "events":
      return { ok: true };
    default:
      return { ok: true };
  }
}

/** app embed-এর Liquid যা সার্ভারেই লেখে (blocks/app-tools-embed.liquid), টুল চালু থাকলে */
function embedExtras(
  kind: PageKind,
  settingsOf: (id: string) => Record<string, unknown> | undefined,
): string {
  const parts: string[] = [];
  const hide = settingsOf("hide-dynamic-checkout");
  if (hide) {
    parts.push(
      `<style>${hide.hideOnProduct && kind === "product" ? ".shopify-payment-button{display:none!important}" : ""}${
        hide.hideOnCart
          ? '.additional-checkout-buttons,[data-shopify="dynamic-checkout-cart"]{display:none!important}'
          : ""
      }</style>`,
    );
  }
  const faq = settingsOf("ai-product-faq");
  if (faq && kind === "product") {
    const colors = faq.colors as { text: string; background: string };
    // snippets/ai-faq.liquid
    parts.push(`<template id="app-ai-faq">
    <div class="ats ats-faq app-ai-faq" data-app-ai-faq style="--ats-pad:12px;--ats-fg:${colors.text};--ats-bg:${colors.background};">
      <h2 class="ats__h" style="text-align:start;font-size:1.3rem">${String(faq.heading)}</h2>
      <div class="ats-faq__list" style="max-width:none">
        <details class="ats-faq__item"><summary>Does it shrink?</summary><div>Very little, if you wash it cold.</div></details>
        <details class="ats-faq__item"><summary>Is it see-through?</summary><div>No, the fabric is 180 gsm.</div></details>
      </div>
    </div>
  </template>`);
  }
  return parts.join("\n  ");
}

function page(kind: PageKind, options: StoreOptions): string {
  const config = buildStoreConfig(
    registry,
    options.tools.map((t) => ({ toolId: t.id, enabled: true, settings: t.settings ?? {} })),
    "professional",
  );
  // ভুল সেটিংস দিলে buildStoreConfig চুপচাপ ডিফল্ট বসায়; পরীক্ষায় সেটা ধরা দরকার
  for (const tool of options.tools) {
    const built = config.tools.find((t) => t.id === tool.id);
    if (!built) throw new Error(`${tool.id} is not a storefront tool`);
    for (const [key, value] of Object.entries(tool.settings ?? {})) {
      if (JSON.stringify(built.settings[key]) !== JSON.stringify(value)) {
        throw new Error(`${tool.id}: setting ${key}=${JSON.stringify(value)} was rejected`);
      }
    }
  }
  const settingsOf = (id: string) => config.tools.find((t) => t.id === id)?.settings;
  const appConfig = {
    assetBase: `${ORIGIN}/cdn/assets/`,
    pageType: kind,
    locale: options.locale ?? "en",
    currency: "USD",
    tzOffset: "+0600",
    shopCurrency: "USD",
    moneyFormat: "${{amount}}",
    marketsCurrencies: 1,
    customerId: null,
    country: options.country ?? "BD",
    defaultSort: kind === "collection" ? "manual" : null,
    countries: ["BD", "US", "DE"],
    tools: config.tools,
    placement: null,
    offers: options.offers ?? null,
    appId: "123",
  };
  const pageProduct = {
    productId: TEE.id,
    handle: TEE.handle,
    tags: TEE.tags,
    createdAt: "2026-11-20T10:00:00+0600",
    compareAtCents: TEE.compareAt,
    title: TEE.title,
    variantId: 111,
    price: "$25.00",
    priceCents: TEE.price,
    available: true,
    inventory: { "111": 4, "112": 0 },
    preorder: [],
    ...options.product,
  };
  const safe = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  const card = (p: Product) => `
        <li class="grid__item">
          <div class="card-wrapper product-card-wrapper">
            <div class="card__media"><img src="/cdn/shop/${p.handle}.png" alt="${p.title}" width="300" height="300"></div>
            <h3 class="card__heading"><a href="/products/${p.handle}">${p.title}</a></h3>
            <div class="price"><span class="price-item">$${(p.price / 100).toFixed(2)}</span></div>
          </div>
        </li>`;
  const main = {
    product: `
      <section class="shopify-section" id="shopify-section-main-product">
        <div class="product">
          <div class="product__media">
            <img src="/cdn/shop/cotton-tee.png" alt="White cotton tee, front" width="560" height="560">
          </div>
          <div class="product__info-container">
            <h1 class="product__title">Cotton tee</h1>
            <div class="price">
              <span class="price-item price-item--sale">$25.00</span>
              <s class="price-item price-item--regular">$30.00</s>
            </div>
            <product-form class="product-form">
              <form method="post" action="/cart/add" id="product-form-main" class="form" data-type="add-to-cart-form">
                <label for="variant-select">Size</label>
                <select id="variant-select" name="id">
                  <option value="111"${pageProduct.variantId === 111 ? " selected" : ""}>Small</option>
                  <option value="112"${pageProduct.variantId === 112 ? " selected" : ""}>Large</option>
                </select>
                <label for="quantity">Quantity</label>
                <input id="quantity" type="number" name="quantity" value="1" min="1">
                <button type="submit" name="add" class="product-form__submit button">${pageProduct.available ? "Add to cart" : "Sold out"}</button>
                <div class="shopify-payment-button"><button type="button" class="shopify-payment-button__button">Buy it now</button></div>
              </form>
            </product-form>
            <div class="product__description rte">
              <p>A soft cotton tee for every day.</p>
              <h2>Materials</h2>
              <p>100% organic cotton.</p>
              <h2>Care</h2>
              <p>Wash cold, dry flat.</p>
            </div>
          </div>
        </div>
      </section>`,
    cart: `
      <section class="shopify-section">
        <h1>Your cart</h1>
        <form action="/cart" method="post" id="cart">
          <ul class="cart-items"><li>Cotton tee × 1</li></ul>
          <p class="totals">Subtotal: $25.00</p>
          <button type="submit" name="checkout" class="cart__checkout-button button">Check out</button>
          <div class="additional-checkout-buttons" data-shopify="dynamic-checkout-cart"><button type="button">Express checkout</button></div>
        </form>
      </section>`,
    collection: `
      <section class="shopify-section">
        <h1>All products</h1>
        <h2>Products</h2>
        <ul class="product-grid grid">${PRODUCTS.map(card).join("")}</ul>
      </section>`,
    index: `
      <section class="shopify-section">
        <h1>Welcome to Test store</h1>
        <p>Everyday clothes and home goods.</p>
        <h2>Featured products</h2>
        <ul class="product-grid grid">${PRODUCTS.map(card).join("")}</ul>
      </section>`,
  }[kind];

  return `<!doctype html>
<html lang="${options.locale ?? "en"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Test store</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; color: #121212; background: #fff; line-height: 1.5; }
    a { color: #121212; }
    .skip { position: absolute; left: -9999px; }
    .skip:focus { left: 8px; top: 8px; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid #ddd; gap: 16px; }
    header nav { display: flex; gap: 16px; }
    main { max-width: 1100px; margin: 0 auto; padding: 24px; }
    .product { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
    .product img { width: 100%; height: auto; background: #eee; }
    @media (max-width: 749px) { .product { grid-template-columns: 1fr; } }
    .price-item--regular { color: #555; margin-left: 8px; }
    label { display: block; margin-top: 12px; }
    select, input { font: inherit; padding: 8px; min-height: 44px; box-sizing: border-box; }
    .button, .shopify-payment-button__button { display: block; width: 100%; margin-top: 12px; min-height: 48px; font: inherit; background: #121212; color: #fff; border: 0; cursor: pointer; }
    .shopify-payment-button__button { background: #5a31f4; }
    .grid { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
    .card__media img { width: 100%; height: auto; background: #eee; }
    .card__heading { font-size: 16px; margin: 8px 0 0; }
    footer { border-top: 1px solid #ddd; padding: 24px; margin-top: 48px; }
  </style>
</head>
<body>
  <a class="skip" href="#MainContent">Skip to content</a>
  <header>
    <a href="/" class="header__heading-link">Test store</a>
    <nav aria-label="Main menu"><a href="/collections/all">Shop</a><a href="/pages/about">About</a></nav>
    <form action="/search" method="get" role="search" class="search">
      <label for="Search-In-Header">Search</label>
      <input id="Search-In-Header" type="search" name="q" placeholder="Search">
    </form>
    <a href="/cart" id="cart-icon-bubble" class="header__icon--cart">Cart <span class="cart-count-bubble">${options.cart?.length ?? 0}</span></a>
  </header>
  <main id="MainContent">${main}</main>
  <footer role="contentinfo">
    <p>© 2026 Test store</p>
    <a href="https://example.com/partner">Partner site</a>
  </footer>
  <script>
    window.Shopify = {
      shop: "test-store.myshopify.com",
      routes: { root: "/" },
      currency: { active: "USD", rate: "1.0" },
      country: "${options.country ?? "BD"}",
      locale: "${options.locale ?? "en"}",
      loadFeatures: function (features, callback) { callback(); },
      analytics: { visitor: function () { return true; } },
      customerPrivacy: {
        shouldShowBanner: function () { return true; },
        currentVisitorConsent: function () { return {}; },
        analyticsProcessingAllowed: function () { return true; },
        setTrackingConsent: function (consent, callback) { callback(); }
      }
    };
    window.__APP_CONFIG__ = ${safe(appConfig)};
    // থিমের নিজের Ajax কার্ট (Dawn-এর product-form-এর মতো): পেজ না বদলে কার্টে যোগ
    document.addEventListener("submit", function (event) {
      var form = event.target;
      if (event.defaultPrevented || !form.matches('form[action="/cart/add"]')) return;
      event.preventDefault();
      fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(new FormData(form))
      })
        .then(function () { return fetch("/cart.js"); })
        .then(function (res) { return res.json(); })
        .then(function (cart) { document.querySelector(".cart-count-bubble").textContent = cart.item_count; });
    });
  </script>
  ${
    kind === "product"
      ? `<script type="application/json" id="app-product-json">${safe(pageProduct)}</script>`
      : ""
  }
  ${embedExtras(kind, settingsOf)}
  <template id="app-payment-icons">
    <svg role="img" aria-labelledby="pi-visa" width="38" height="24" viewBox="0 0 38 24"><title id="pi-visa">Visa</title><rect width="38" height="24" rx="3" fill="#1a1f71"/></svg>
    <svg role="img" aria-labelledby="pi-master" width="38" height="24" viewBox="0 0 38 24"><title id="pi-master">Mastercard</title><rect width="38" height="24" rx="3" fill="#eb001b"/></svg>
  </template>
  <script src="/cdn/assets/loader.js" type="module" defer></script>
</body>
</html>`;
}

/** দোকান খোলা: নকল সার্ভার বসিয়ে পাতাটা লোড করে */
export async function openStore(pageRef: Page, options: StoreOptions): Promise<Store> {
  const kind = options.page ?? "product";
  const cart = new Cart();
  cart.add(options.cart ?? []);
  const proxyCalls: string[] = [];

  // Headless Chromium-এ অনুমতি সবসময় "denied"; নতুন ক্রেতার ব্রাউজারে থাকে "default"
  await pageRef.addInitScript(() => {
    try {
      Object.defineProperty(Notification, "permission", { get: () => "default" });
    } catch {
      // Notification নেই
    }
  });
  if (options.storage) {
    await pageRef.addInitScript((items: Record<string, string>) => {
      for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
    }, options.storage);
  }

  await pageRef.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    let body: Record<string, unknown> = {};
    try {
      body = (request.postDataJSON() as Record<string, unknown> | null) ?? {};
    } catch {
      // form data
      const raw = request.postData() ?? "";
      body = Object.fromEntries(new URLSearchParams(raw));
    }

    if (path.startsWith("/cdn/assets/")) {
      const file = path.slice("/cdn/assets/".length);
      try {
        const content = readFileSync(ASSETS + file);
        return route.fulfill({
          status: 200,
          contentType: file.endsWith(".css") ? "text/css" : "application/javascript",
          body: content,
        });
      } catch {
        return route.fulfill({ status: 404, body: "" });
      }
    }
    if (path.startsWith("/cdn/shop/")) {
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    }
    if (path === "/cart.js") return json(route, cart.json());
    if (path === "/cart/add.js" || path === "/cart/add") {
      const items = Array.isArray(body.items)
        ? (body.items as Array<Record<string, unknown>>).map((i) => ({
            variant_id: Number(i.id),
            quantity: Number(i.quantity) || 1,
            properties: (i.properties as Record<string, string>) ?? null,
          }))
        : [{ variant_id: Number(body.id), quantity: Number(body.quantity) || 1 }];
      cart.add(items);
      const added = cart
        .json()
        .items.filter((i) => items.some((x) => x.variant_id === i.variant_id));
      return json(route, Array.isArray(body.items) ? { items: added } : (added[0] ?? {}));
    }
    if (path === "/cart/change.js") {
      cart.change(Number(body.line) || 1, Number(body.quantity));
      return json(route, cart.json());
    }
    if (path === "/cart/update.js") {
      if (body.attributes) Object.assign(cart.attributes, body.attributes);
      if (typeof body.note === "string") cart.note = body.note;
      return json(route, cart.json());
    }
    if (path === "/cart/clear.js") {
      cart.lines = [];
      return json(route, cart.json());
    }
    const productJs = path.match(/^\/products\/([\w-]+)\.js$/);
    if (productJs) {
      const product = PRODUCTS.find((p) => p.handle === productJs[1]);
      return product ? json(route, ajaxProduct(product)) : json(route, {}, 404);
    }
    if (path === "/recommendations/products.json") {
      return json(route, { products: PRODUCTS.slice(1).map(ajaxProduct) });
    }
    if (path === "/search/suggest.json") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const products = PRODUCTS.filter((p) => p.title.toLowerCase().includes(q)).map((p) => ({
        ...ajaxProduct(p),
        image: `//shop.test/cdn/shop/${p.handle}.png`,
        price: (p.price / 100).toFixed(2),
      }));
      return json(route, {
        resources: {
          results: {
            products,
            collections: [],
            pages: [],
            articles: [],
            queries: q ? [{ text: `${q} tee`, styled_text: `${q} tee` }] : [],
          },
        },
      });
    }
    if (path === "/browsing_context_suggestions.json") {
      return json(route, {
        detected_values: { country: { handle: "DE", name: "Germany" } },
        suggestions: [],
      });
    }
    if (path === "/contact" || path === "/discount/" || path.startsWith("/discount/")) {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<p>ok</p>" });
    }
    if (path.startsWith("/apps/app-tools/")) {
      const sub = path.slice("/apps/app-tools/".length) + url.search;
      proxyCalls.push(`${method} ${sub}`);
      if (sub.startsWith("sw.js")) {
        return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
      }
      return json(route, proxyAnswer(sub, method, options));
    }
    if (
      method === "GET" &&
      (path === "/" ||
        path.startsWith("/products/") ||
        path.startsWith("/collections/") ||
        path === "/cart" ||
        path.startsWith("/pages/"))
    ) {
      const kindFor: PageKind = path.startsWith("/products/")
        ? "product"
        : path.startsWith("/collections/")
          ? "collection"
          : path === "/cart"
            ? "cart"
            : "index";
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: page(kindFor, options),
      });
    }
    return route.fulfill({ status: 404, contentType: "text/plain", body: "not found" });
  });

  const url = {
    product: "/products/cotton-tee",
    cart: "/cart",
    collection: "/collections/all",
    index: "/",
  }[kind];
  await pageRef.goto(ORIGIN + url);
  return { cart, proxyCalls };
}
