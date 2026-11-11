import type { register } from "@shopify/web-pixels-extension";
import {
  addToCartData,
  checkoutData,
  cookieString,
  fbcValue,
  fbpValue,
  maySendToMeta,
  metaUrl,
  parsePixelIds,
  purchaseId,
  viewContentData,
  type BrowserIds,
  type MetaData,
  type MetaEvent,
  type MetaEventName,
} from "./meta";

/**
 * স্টোরের পিক্সেল, দুটো আলাদা কাজ:
 * ১. স্টোরের Analytics: শুধু গোনার মতো তথ্য আমাদের সার্ভারে পাঠায় (পেজের path, ইভেন্টের ধরন,
 *    অর্ডারের মোট দাম); নাম, ইমেইল, ফোন বা ঠিকানা কখনো পাঠায় না।
 * ২. Facebook Pixels টুল: মার্চেন্টের Meta পিক্সেলে ইভেন্ট পাঠায়, তবে শুধু সেই ক্রেতার জন্য
 *    যিনি মার্কেটিং কুকিতে রাজি আর তথ্য শেয়ারে আপত্তি জানাননি (নিচে startMeta)।
 */
type Kind = "page" | "product" | "cart" | "checkout" | "order";

interface OutEvent {
  t: Kind;
  p?: string;
  r?: string;
  q?: string;
  a?: number;
}

type Api = Parameters<Parameters<typeof register>[0]>[0];

/** সম্মতি আসার আগে একটা পেজে সর্বোচ্চ কতগুলো ইভেন্ট ধরে রাখা হবে */
const MAX_WAITING = 10;

/**
 * Meta পিক্সেলে ইভেন্ট পাঠানো।
 * পিক্সেলটা Analytics-এর সম্মতিতেই লোড হয়, তাই মার্কেটিং সম্মতি এখানে নিজে দেখা হয়:
 * সম্মতি না থাকলে কিছুই পাঠানো হয় না, কুকিও বসে না। একই পেজে পরে সম্মতি দিলে সেই পেজের
 * জমে থাকা ইভেন্টগুলো তখন যায়; সম্মতি না দিলে সেগুলো ব্রাউজার ছেড়ে কোথাও যায় না।
 */
function startMeta({ analytics, browser, init, customerPrivacy }: Api, pixelIds: string[]) {
  if (pixelIds.length === 0) return;

  type Page = { href: unknown; referrer: unknown };
  let allowed = maySendToMeta(init.customerPrivacy);
  let waiting: Array<{ event: MetaEvent; page: Page }> = [];
  let ids: Promise<BrowserIds> | null = null;

  /** _fbp আর _fbc কুকি পড়া, দরকার হলে বসানো। শুধু সম্মতির পরে ডাকা হয়। */
  const browserIds = () => {
    ids ??= (async () => {
      const now = Date.now();
      const found: BrowserIds = { fbp: "", fbc: "" };
      try {
        const fbp = await browser.cookie.get("_fbp");
        found.fbp = fbpValue(fbp, now, Math.random());
        if (found.fbp !== fbp) await browser.cookie.set(cookieString("_fbp", found.fbp));
        const fbc = await browser.cookie.get("_fbc");
        found.fbc = fbcValue(fbc, init.context.document?.location?.href, now);
        if (found.fbc && found.fbc !== fbc)
          await browser.cookie.set(cookieString("_fbc", found.fbc));
      } catch {
        // কুকি পড়া বা লেখা না গেলেও ইভেন্ট যাবে, শুধু কুকির মান ছাড়া
      }
      return found;
    })();
    return ids;
  };

  const send = async ({ event, page }: { event: MetaEvent; page: Page }) => {
    const found = await browserIds();
    for (const pixelId of pixelIds) {
      // উত্তর পড়ার দরকার নেই; keepalive থাকায় পেজ বদলালেও অনুরোধ শেষ হয়
      void fetch(metaUrl(pixelId, event, page, found), {
        method: "GET",
        mode: "no-cors",
        credentials: "include",
        keepalive: true,
      }).catch(() => undefined);
    }
  };

  const track = (
    name: MetaEventName,
    id: string,
    data: MetaData | null,
    context: { document: { location: { href: string }; referrer: string } },
  ) => {
    if (!data) return;
    const item = {
      event: { name, id, time: Date.now(), data },
      page: { href: context.document.location.href, referrer: context.document.referrer },
    };
    if (allowed) void send(item);
    else if (waiting.length < MAX_WAITING) waiting.push(item);
  };

  customerPrivacy.subscribe("visitorConsentCollected", (event) => {
    allowed = maySendToMeta(event.customerPrivacy);
    const held = waiting;
    waiting = [];
    if (allowed) for (const item of held) void send(item);
  });

  analytics.subscribe("page_viewed", (event) => {
    track("PageView", event.id, {}, event.context);
  });
  analytics.subscribe("product_viewed", (event) => {
    track("ViewContent", event.id, viewContentData(event.data.productVariant), event.context);
  });
  analytics.subscribe("product_added_to_cart", (event) => {
    track("AddToCart", event.id, addToCartData(event.data.cartLine), event.context);
  });
  analytics.subscribe("checkout_started", (event) => {
    track("InitiateCheckout", event.id, checkoutData(event.data.checkout), event.context);
  });
  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data.checkout;
    track("Purchase", purchaseId(checkout, event.id), checkoutData(checkout), event.context);
  });
}

/** Shopify পিক্সেল লোড করলে এটা একবার চলে (index.ts থেকে) */
export function startPixel(api: Api) {
  const { analytics, browser, init, settings } = api;
  const endpoint = String(settings.endpoint ?? "");
  const key = String(settings.ingestKey ?? "");
  if (!endpoint || !key) return;

  startMeta(api, parsePixelIds(settings.metaPixels));

  const ua = init.context.navigator?.userAgent ?? "";
  const host = init.context.document?.location?.host ?? "";
  let clientId = "";
  let queue: OutEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (queue.length === 0 || !clientId) return;
    const body = JSON.stringify({ k: key, v: clientId, h: host, ua, e: queue });
    queue = [];
    // text/plain হলে CORS preflight লাগে না
    void browser.sendBeacon(endpoint, body);
  };

  const push = (id: string, event: OutEvent, now = false) => {
    if (id) clientId = id;
    queue.push(event);
    if (now || queue.length >= 20) {
      if (timer) clearTimeout(timer);
      flush();
    } else if (!timer) {
      timer = setTimeout(flush, 500);
    }
  };

  analytics.subscribe("page_viewed", (event) => {
    const loc = event.context.document.location;
    push(event.clientId, {
      t: "page",
      p: loc.pathname.slice(0, 200),
      r: event.context.document.referrer.slice(0, 300),
      q: loc.search.slice(0, 300),
    });
  });

  analytics.subscribe("product_viewed", (event) => {
    push(event.clientId, { t: "product" });
  });

  analytics.subscribe("product_added_to_cart", (event) => {
    push(event.clientId, { t: "cart" });
  });

  analytics.subscribe("checkout_started", (event) => {
    push(event.clientId, { t: "checkout" });
  });

  analytics.subscribe("checkout_completed", (event) => {
    const amount = event.data.checkout.totalPrice?.amount;
    push(event.clientId, { t: "order", a: typeof amount === "number" ? amount : 0 }, true);
  });
}
