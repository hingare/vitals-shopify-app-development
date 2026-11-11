import { beforeEach, describe, expect, it, vi } from "vitest";
import { startPixel } from "../../extensions/web-pixel/src/pixel";

/**
 * পুরো পিক্সেল নকল Shopify sandbox-এ চালিয়ে দেখা: সম্মতি ছাড়া Meta-তে কিছু যায় না,
 * কুকিও বসে না; সম্মতি এলে তবেই যায়।
 */
type Callback = (event: unknown) => void;
const start = startPixel as unknown as (api: unknown) => void;

interface Consent {
  analyticsProcessingAllowed: boolean;
  marketingAllowed: boolean;
  preferencesProcessingAllowed: boolean;
  saleOfDataAllowed: boolean;
}
const consent = (marketing: boolean, sale = true): Consent => ({
  analyticsProcessingAllowed: true,
  marketingAllowed: marketing,
  preferencesProcessingAllowed: false,
  saleOfDataAllowed: sale,
});

const PAGE = "https://shop.example/products/board?fbclid=IwAR2_click";
const context = {
  document: { location: { href: PAGE, pathname: "/products/board", search: "" }, referrer: "" },
};

function sandbox(options: { settings?: Record<string, unknown>; privacy: Consent }) {
  const subscribers = new Map<string, Callback[]>();
  const privacySubscribers: Callback[] = [];
  const cookies = new Map<string, string>();
  const beacons: string[] = [];
  const api = {
    settings: {
      endpoint: "https://app.example/ingest/pixel",
      ingestKey: "key-1",
      ...options.settings,
    },
    analytics: {
      subscribe: (name: string, callback: Callback) => {
        subscribers.set(name, [...(subscribers.get(name) ?? []), callback]);
      },
    },
    browser: {
      cookie: {
        get: async (name: string) => cookies.get(name) ?? "",
        set: async (cookie: string) => {
          const [pair = ""] = cookie.split(";");
          const [name = "", value = ""] = pair.split("=");
          cookies.set(name, value);
          return cookie;
        },
      },
      sendBeacon: async (_url: string, body: string) => {
        beacons.push(body);
        return true;
      },
    },
    init: {
      context: { navigator: { userAgent: "test" }, document: context.document },
      customerPrivacy: options.privacy,
    },
    customerPrivacy: {
      subscribe: (_name: string, callback: Callback) => {
        privacySubscribers.push(callback);
      },
    },
  };
  start(api);
  let counter = 0;
  return {
    cookies,
    beacons,
    emit: (name: string, data: unknown = {}) => {
      counter += 1;
      const event = { id: `sh-${counter}`, clientId: "client-1", context, data };
      for (const callback of subscribers.get(name) ?? []) callback(event);
    },
    setConsent: (privacy: Consent) => {
      for (const callback of privacySubscribers) callback({ customerPrivacy: privacy });
    },
  };
}

/** কুকি পড়া আর fetch শেষ হওয়ার জন্য অপেক্ষা */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>(
  async () => new Response(""),
);
const sentUrls = () => fetchMock.mock.calls.map((call) => new URL(String(call[0])));

const variant = {
  id: "44401",
  price: { amount: 20, currencyCode: "USD" },
  product: { id: "43482", title: "Board" },
};

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

describe("Meta events in the web pixel", () => {
  it("sends nothing to Meta when no pixel id is set", async () => {
    const box = sandbox({ settings: { metaPixels: "none" }, privacy: consent(true) });
    box.emit("page_viewed");
    box.emit("product_viewed", { productVariant: variant });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(box.cookies.size).toBe(0);
  });

  it("works with settings saved before the Meta field existed", async () => {
    const box = sandbox({ privacy: consent(true) });
    box.emit("page_viewed");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends each event to every pixel when the visitor allowed marketing", async () => {
    const box = sandbox({
      settings: { metaPixels: "11111111,22222222" },
      privacy: consent(true),
    });
    box.emit("page_viewed");
    box.emit("product_viewed", { productVariant: variant });
    await settle();

    const urls = sentUrls();
    expect(urls.map((u) => `${u.searchParams.get("id")}:${u.searchParams.get("ev")}`)).toEqual([
      "11111111:PageView",
      "22222222:PageView",
      "11111111:ViewContent",
      "22222222:ViewContent",
    ]);
    expect(urls.every((u) => u.hostname === "www.facebook.com")).toBe(true);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET", keepalive: true });
    // দুই পিক্সেলে একই ব্রাউজার id, আর বিজ্ঞাপনের ক্লিক id ঠিকানা থেকে
    const fbp = urls[0]?.searchParams.get("fbp");
    expect(fbp).toMatch(/^fb\.1\.\d+\.\d{10}$/);
    expect(urls.every((u) => u.searchParams.get("fbp") === fbp)).toBe(true);
    expect(urls[0]?.searchParams.get("fbc")).toMatch(/^fb\.1\.\d+\.IwAR2_click$/);
    expect(box.cookies.get("_fbp")).toBe(fbp);
  });

  it("keeps an existing _fbp cookie instead of making a new one", async () => {
    const box = sandbox({ settings: { metaPixels: "11111111" }, privacy: consent(true) });
    box.cookies.set("_fbp", "fb.1.1596403881668.1116446470");
    box.emit("page_viewed");
    await settle();
    expect(sentUrls()[0]?.searchParams.get("fbp")).toBe("fb.1.1596403881668.1116446470");
    expect(box.cookies.get("_fbp")).toBe("fb.1.1596403881668.1116446470");
  });

  it("sends nothing and sets no cookie without marketing consent", async () => {
    const box = sandbox({ settings: { metaPixels: "11111111" }, privacy: consent(false) });
    box.emit("page_viewed");
    box.emit("product_viewed", { productVariant: variant });
    box.emit("product_added_to_cart", { cartLine: { merchandise: variant, quantity: 1 } });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(box.cookies.size).toBe(0);
    // স্টোরের নিজের Analytics আগের মতোই চলে
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(box.beacons).toHaveLength(1);
  });

  it("sends nothing when the visitor opted out of data sharing", async () => {
    const box = sandbox({ settings: { metaPixels: "11111111" }, privacy: consent(true, false) });
    box.emit("page_viewed");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(box.cookies.size).toBe(0);
  });

  it("sends the events of the page once consent is given on that page", async () => {
    const box = sandbox({ settings: { metaPixels: "11111111" }, privacy: consent(false) });
    box.emit("page_viewed");
    box.emit("product_viewed", { productVariant: variant });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    box.setConsent(consent(true));
    await settle();
    expect(sentUrls().map((u) => u.searchParams.get("ev"))).toEqual(["PageView", "ViewContent"]);

    box.emit("product_added_to_cart", { cartLine: { merchandise: variant, quantity: 2 } });
    await settle();
    expect(sentUrls().map((u) => u.searchParams.get("ev"))).toEqual([
      "PageView",
      "ViewContent",
      "AddToCart",
    ]);
  });

  it("drops held events and stops when consent is refused", async () => {
    const box = sandbox({ settings: { metaPixels: "11111111" }, privacy: consent(false) });
    box.emit("page_viewed");
    box.setConsent(consent(false));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    // পরে রাজি হলেও আগের (ফেলে দেওয়া) ইভেন্ট আর যায় না
    box.setConsent(consent(true));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops as soon as consent is withdrawn", async () => {
    const box = sandbox({ settings: { metaPixels: "11111111" }, privacy: consent(true) });
    box.emit("page_viewed");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    box.setConsent(consent(false));
    box.emit("product_viewed", { productVariant: variant });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("holds at most ten events while waiting for consent", async () => {
    const box = sandbox({ settings: { metaPixels: "11111111" }, privacy: consent(false) });
    for (let i = 0; i < 25; i++) box.emit("page_viewed");
    box.setConsent(consent(true));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("sends a purchase with the order number as its id and without the checkout link", async () => {
    const box = sandbox({ settings: { metaPixels: "11111111" }, privacy: consent(true) });
    box.emit("checkout_completed", {
      checkout: {
        currencyCode: "USD",
        email: "buyer@example.com",
        totalPrice: { amount: 45.5, currencyCode: "USD" },
        lineItems: [{ quantity: 2, variant }],
        order: { id: "5011230720085" },
        token: "SECRETTOKEN",
      },
    });
    await settle();
    const [url] = sentUrls();
    expect(url?.searchParams.get("ev")).toBe("Purchase");
    expect(url?.searchParams.get("eid")).toBe("order-5011230720085");
    expect(url?.searchParams.get("cd[value]")).toBe("45.5");
    expect(url?.searchParams.get("cd[content_ids]")).toBe('["44401"]');
    expect(url?.href).not.toContain("buyer");
    expect(url?.href).not.toContain("SECRETTOKEN");
  });

  it("skips a product event that has no product in it", async () => {
    const box = sandbox({ settings: { metaPixels: "11111111" }, privacy: consent(true) });
    box.emit("product_viewed", { productVariant: null });
    box.emit("product_added_to_cart", { cartLine: null });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still sends the event when cookies cannot be read", async () => {
    const box = sandbox({ settings: { metaPixels: "11111111" }, privacy: consent(true) });
    box.cookies.get = () => {
      throw new Error("blocked");
    };
    box.emit("page_viewed");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentUrls()[0]?.searchParams.has("fbp")).toBe(false);
  });
});
