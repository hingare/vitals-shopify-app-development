import { register } from "@shopify/web-pixels-extension";

/**
 * স্টোরের Analytics পিক্সেল।
 * শুধু গোনার মতো তথ্য পাঠায় (পেজের path, ইভেন্টের ধরন, অর্ডারের মোট দাম);
 * নাম, ইমেইল, ফোন বা ঠিকানা কখনো পাঠায় না।
 */
type Kind = "page" | "product" | "cart" | "checkout" | "order";

interface OutEvent {
  t: Kind;
  p?: string;
  r?: string;
  q?: string;
  a?: number;
}

register(({ analytics, browser, init, settings }) => {
  const endpoint = String(settings.endpoint ?? "");
  const key = String(settings.ingestKey ?? "");
  if (!endpoint || !key) return;

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
});
