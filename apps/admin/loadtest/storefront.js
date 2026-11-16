/**
 * ১,০০০ দোকানের ব্যস্ত সময়ের স্টোরফ্রন্ট ট্রাফিক (k6)। কীভাবে চালাবেন: loadtest/README.md
 *
 *   k6 run -e BASE_URL=https://staging.example.com -e SHOPIFY_API_SECRET=... loadtest/storefront.js
 *
 * আমাদের সার্ভারে যা আসে শুধু সেটুকু মাপা হয়: থিমের ফাইল আর কনফিগ Shopify-র CDN থেকে যায়, তাই সেগুলো নেই।
 * App Proxy-র অনুরোধ Shopify-র মতোই সই করা থাকে, webhook-এ Shopify-র মতো HMAC থাকে।
 */
/* global __ENV */
import http from "k6/http";
import crypto from "k6/crypto";
import { check } from "k6";

const env = (name, fallback) => __ENV[name] ?? fallback;
const BASE = env("BASE_URL", "http://localhost:3000").replace(/\/$/, "");
const SECRET = env("SHOPIFY_API_SECRET", "");
const PREFIX = env("SHOP_PREFIX", "loadtest-");
const STORES = Number(env("STORES", 1000));
/** একটা দোকানে দিনে গড় ভিজিট আর প্রতি ভিজিটে পাতা */
const SESSIONS = Number(env("SESSIONS_PER_STORE_DAY", 2000));
const PAGES = Number(env("PAGES_PER_SESSION", 4));
const SESSION_SECONDS = Number(env("SESSION_SECONDS", 180));
/** ব্যস্ত সময়ে গড়ের কত গুণ */
const PEAK = Number(env("PEAK_FACTOR", 3));
const ORDERS = Number(env("ORDERS_PER_STORE_DAY", 30));
const CHECKOUTS = Number(env("CHECKOUTS_PER_STORE_DAY", 100));
/** পুরো হিসাবের কত অংশ চালানো হবে (যেমন 0.1 মানে দশ ভাগের এক) */
const SCALE = Number(env("SCALE", 1));
const DURATION = env("DURATION", "10m");

if (!SECRET) throw new Error("Set SHOPIFY_API_SECRET to the app's secret on the server under test");

const DAY = 86_400;
const pageviews = ((STORES * SESSIONS * PAGES) / DAY) * PEAK * SCALE;
const visitorsOnline = ((STORES * SESSIONS * SESSION_SECONDS) / DAY) * PEAK * SCALE;

/** প্রতি সেকেন্ডে কত অনুরোধ, আর কোন অনুমানে */
export const RATES = {
  // Web Pixel: পাতা প্রতি একবার (৫০০ms-এর ইভেন্ট একসাথে যায়)
  pixel: pageviews,
  // উইজেটের view/click: বেশিরভাগ পাতায় একবার (৩ সেকেন্ডের ইভেন্ট একসাথে)
  events: pageviews * 0.8,
  // রিভিউ: ৪০% পাতা প্রোডাক্ট পাতা, অর্ধেক দোকানে Reviews চালু
  reviews: pageviews * 0.2,
  // Recent Sales: ব্রাউজার এক মিনিট মনে রাখে
  recentSales: pageviews * 0.1,
  // Live Chat: ৩০% দোকানে চালু, বন্ধ অবস্থায় প্রতি ৩০ সেকেন্ডে একবার খোঁজ
  chatPoll: (visitorsOnline * 0.3) / 30,
  ordersPaid: ((STORES * ORDERS) / DAY) * PEAK * SCALE,
  // একটা চেকআউটে গড়ে তিনবার checkouts/update
  checkouts: ((STORES * CHECKOUTS * 3) / DAY) * PEAK * SCALE,
};

const scenario = (exec, perSecond) => {
  const perMinute = Math.max(1, Math.round(perSecond * 60));
  return {
    executor: "constant-arrival-rate",
    exec,
    rate: perMinute,
    timeUnit: "1m",
    duration: DURATION,
    preAllocatedVUs: Math.max(5, Math.ceil(perSecond / 2)),
    maxVUs: Math.max(20, Math.ceil(perSecond * 3)),
  };
};

export const options = {
  discardResponseBodies: true,
  scenarios: {
    pixel: scenario("pixel", RATES.pixel),
    events: scenario("events", RATES.events),
    reviews: scenario("reviews", RATES.reviews),
    recentSales: scenario("recentSales", RATES.recentSales),
    chatPoll: scenario("chatPoll", RATES.chatPoll),
    ordersPaid: scenario("ordersPaid", RATES.ordersPaid),
    checkouts: scenario("checkouts", RATES.checkouts),
  },
  thresholds: {
    // ৪২৯ (রেট লিমিট) এখানে ব্যর্থ ধরা হয়: লোড টেস্টে তা আসার কথা নয়
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:storefront}": ["p(95)<300", "p(99)<1000"],
    "http_req_duration{kind:webhook}": ["p(95)<1000"],
    dropped_iterations: ["count<100"],
  },
};

export function setup() {
  console.log(
    `Peak load for ${STORES} stores x ${SCALE}: ` +
      Object.entries(RATES)
        .map(([name, rate]) => `${name} ${rate.toFixed(1)}/s`)
        .join(", "),
  );
}

const pick = (n) => 1 + Math.floor(Math.random() * n);
const pad = (i) => String(i).padStart(4, "0");
const shopNumber = () => pick(STORES);
const shopDomain = (i) => `${PREFIX}${pad(i)}.myshopify.com`;
const product = () => String(1000 + pick(5));
/** প্রতিটা অনুরোধ আলাদা ভিজিটরের মতো (রেট লিমিট দোকান আর ভিজিটর ধরে) */
const visitorIp = () => `${pick(223)}.${pick(254)}.${pick(254)}.${pick(254)}`;
const TOOLS = ["sticky-atc", "announcement-bar", "trust-seals", "free-gifts", "product-labels"];

/** Shopify App Proxy যেভাবে সই করে: প্যারামিটারগুলো নামের ক্রমে key=value, মাঝে কিছু নেই */
function proxyUrl(path, shop, extra = {}) {
  const params = {
    logged_in_customer_id: "",
    path_prefix: "/apps/app-tools",
    shop,
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...extra,
  };
  const message = Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${params[key]}`)
    .join("");
  const signature = crypto.hmac("sha256", SECRET, message, "hex");
  const query = Object.entries({ ...params, signature })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${BASE}/proxy/${path}?${query}`;
}

const proxyHeaders = (json) => ({
  "X-Forwarded-For": visitorIp(),
  ...(json ? { "Content-Type": "application/json" } : {}),
});
const ok = (res, name) => check(res, { [`${name} ok`]: (r) => r.status >= 200 && r.status < 300 });

export function pixel() {
  const i = shopNumber();
  const body = JSON.stringify({
    k: `lt-key-${pad(i)}`,
    v: `visitor-${Math.random().toString(36).slice(2, 12)}`,
    h: shopDomain(i),
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148",
    e: [
      { t: "page", p: "/products/linen-shirt", r: "https://www.google.com/" },
      { t: "product", p: "/products/linen-shirt" },
    ],
  });
  const res = http.post(`${BASE}/ingest/pixel`, body, {
    headers: { "Content-Type": "text/plain", "X-Forwarded-For": visitorIp() },
    tags: { kind: "storefront", name: "pixel" },
  });
  ok(res, "pixel");
}

export function events() {
  const body = JSON.stringify({
    events: [
      { toolId: TOOLS[pick(TOOLS.length) - 1], type: "view" },
      { toolId: TOOLS[pick(TOOLS.length) - 1], type: Math.random() < 0.1 ? "click" : "view" },
    ],
  });
  const res = http.post(proxyUrl("events", shopDomain(shopNumber())), body, {
    headers: proxyHeaders(true),
    tags: { kind: "storefront", name: "events" },
  });
  ok(res, "events");
}

export function reviews() {
  const res = http.get(
    proxyUrl("reviews", shopDomain(shopNumber()), { product: product(), page: "1" }),
    { headers: proxyHeaders(false), tags: { kind: "storefront", name: "reviews" } },
  );
  ok(res, "reviews");
}

export function recentSales() {
  const res = http.get(proxyUrl("recent-sales", shopDomain(shopNumber())), {
    headers: proxyHeaders(false),
    tags: { kind: "storefront", name: "recent-sales" },
  });
  ok(res, "recent-sales");
}

export function chatPoll() {
  const res = http.post(
    proxyUrl("chat", shopDomain(shopNumber())),
    JSON.stringify({ action: "read", open: false }),
    { headers: proxyHeaders(true), tags: { kind: "storefront", name: "chat" } },
  );
  ok(res, "chat");
}

/** Shopify-র webhook: শরীরের HMAC (base64) আর দরকারি হেডার */
function webhook(path, topic, payload) {
  const body = JSON.stringify(payload);
  const res = http.post(`${BASE}/webhooks/${path}`, body, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": shopDomain(shopNumber()),
      "X-Shopify-API-Version": "2026-10",
      "X-Shopify-Webhook-Id": `lt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      "X-Shopify-Hmac-Sha256": crypto.hmac("sha256", SECRET, body, "base64"),
    },
    tags: { kind: "webhook", name: topic },
  });
  ok(res, topic);
}

export function ordersPaid() {
  // line_items আর email ছাড়া: তাহলে কোডটা Shopify-কে কিছু জিজ্ঞেস করে না, শুধু ডাটাবেসে লেখে
  webhook("orders/paid", "orders/paid", {
    id: Number(`${Date.now()}${pick(999)}`),
    total_price: "49.90",
    currency: "USD",
    note_attributes: [{ name: "_app_tools", value: "sticky-atc,free-gifts" }],
    discount_applications: [],
  });
}

export function checkouts() {
  webhook("checkouts", "checkouts/update", {
    token: `lt-${pick(1_000_000)}`,
    updated_at: new Date().toISOString(),
    completed_at: null,
  });
}
