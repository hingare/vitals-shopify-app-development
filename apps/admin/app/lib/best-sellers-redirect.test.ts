import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Best Sellers Protection-এর ফেরত পাঠানোর কোডটা app embed-এর Liquid ফাইলে বসানো ছোট স্ক্রিপ্ট
 * (লোডারের আগে চলে)। CI-তে Liquid চলে না, তাই এখানে ফাইল থেকে স্ক্রিপ্টটা তুলে নকল ব্রাউজারে চালানো হয়।
 */
const liquid = readFileSync(
  join(__dirname, "../../extensions/theme-embed/blocks/app-tools-embed.liquid"),
  "utf8",
);
const script = /<script id="app-bsp">([\s\S]*?)<\/script>/.exec(liquid)?.[1] ?? "";

type Storage = Map<string, string>;

interface PageOptions {
  /** এই ট্যাবের sessionStorage; null মানে ব্রাউজার সেটা বন্ধ রেখেছে */
  storage: Storage | null;
  /** পেজ খোলার সময় (Date.now()) */
  now: number;
  /** যে পেজ থেকে আসা হলো (document.referrer); ঠিকানা লিখে বা বুকমার্ক থেকে এলে ফাঁকা */
  referrer?: string;
}

/** একটা পেজ খোলা: স্ক্রিপ্ট একবার চলে, যেমন পেজের HTML-এর শেষে চলত */
function openPage(href: string, { storage, now, referrer = "" }: PageOptions) {
  const location = {
    href,
    replaced: [] as string[],
    replace(to: string) {
      this.replaced.push(to);
    },
  };
  const blocked = () => {
    throw new Error("storage is blocked");
  };
  const sessionStorage = storage
    ? {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: unknown) => void storage.set(key, String(value)),
      }
    : { getItem: blocked, setItem: blocked };
  const root = { style: { visibility: "" } };
  const timers: Array<() => void> = [];
  const window: { __APP_BSP__?: () => void } = {};
  const clock = { now };
  new Function("window", "location", "sessionStorage", "document", "Date", "setTimeout", script)(
    window,
    location,
    sessionStorage,
    { documentElement: root, referrer },
    { now: () => clock.now },
    (fn: () => void) => timers.push(fn),
  );
  return {
    location,
    root,
    timers,
    clock,
    /** থিম পেজ লোড না করে ঠিকানা বদলালে (pushState) উইজেট এভাবে আবার ডাকে */
    visit(next: string) {
      location.href = next;
      window.__APP_BSP__?.();
    },
  };
}

const SHIRTS = "https://shop.example/collections/shirts";
const BEST = `${SHIRTS}?sort_by=best-selling`;

describe("best sellers redirect script in the app embed", () => {
  it("is present in the Liquid file, without comments that would reach shoppers", () => {
    expect(script).toContain("__APP_BSP__");
    expect(script).not.toMatch(/\/\/|\/\*/);
  });

  it("sends a best-selling link to the normal order and keeps filters", () => {
    const page = openPage(
      `${SHIRTS}?filter.v.availability=1&sort_by=best-selling&page=3&q=blue+shirt#grid`,
      { storage: new Map(), now: 1000 },
    );
    expect(page.location.replaced).toEqual([`${SHIRTS}?filter.v.availability=1&q=blue+shirt#grid`]);
    // নতুন পেজ আসা পর্যন্ত তালিকা দেখা যায় না
    expect(page.root.style.visibility).toBe("hidden");
  });

  it("removes every sort_by when best-selling is one of several", () => {
    const page = openPage(`${SHIRTS}?sort_by=price-ascending&sort_by=best-selling`, {
      storage: new Map(),
      now: 1000,
    });
    expect(page.location.replaced).toEqual([SHIRTS]);
  });

  it("leaves other pages alone and remembers nothing about them", () => {
    const storage: Storage = new Map();
    for (const href of [SHIRTS, `${SHIRTS}?sort_by=price-ascending`, `${SHIRTS}?q=best-selling`]) {
      const page = openPage(href, { storage, now: 1000 });
      expect(page.location.replaced).toEqual([]);
      expect(page.root.style.visibility).toBe("");
    }
    expect(storage.size).toBe(0);
  });

  it("shows the page again if the browser never leaves it", () => {
    const page = openPage(BEST, { storage: new Map(), now: 1000 });
    expect(page.timers).toHaveLength(1);
    page.timers[0]!();
    expect(page.root.style.visibility).toBe("");
  });

  it("redirects once however often it is called on the same page", () => {
    const storage: Storage = new Map();
    const page = openPage(BEST, { storage, now: 1000 });
    page.visit(BEST);
    page.visit(BEST);
    expect(page.location.replaced).toHaveLength(1);
    // এক পেজে এক বারই গোনা হয়
    expect(storage.get("app-bsp")).toBe("1000 1");
  });

  it("redirects when the theme switches to best-selling without loading a new page", () => {
    // পেজটায় আসা হয়েছিল একই কালেকশনের আগের পেজ থেকে (যেমন পেজ ১ থেকে ২)
    const page = openPage(`${SHIRTS}?page=2`, { storage: new Map(), now: 1000, referrer: SHIRTS });
    expect(page.location.replaced).toEqual([]);
    page.clock.now = 2500;
    page.visit(`${SHIRTS}?page=2&sort_by=best-selling`);
    expect(page.location.replaced).toEqual([SHIRTS]);
  });

  it("stops when the theme itself keeps sending the normal page to best-selling", () => {
    const storage: Storage = new Map();
    // থিম সাধারণ পেজ থেকে এখানে পাঠাল; প্রথমবার আমরা ফেরত পাঠাই
    const first = openPage(BEST, { storage, now: 1000, referrer: SHIRTS });
    expect(first.location.replaced).toEqual([SHIRTS]);
    // থিম আবার পাঠাল: এবার থামা
    const second = openPage(BEST, { storage, now: 2600, referrer: SHIRTS });
    expect(second.location.replaced).toEqual([]);
    expect(second.root.style.visibility).toBe("");
    expect(storage.get("app-bsp")).toBe("off");
    // এই ট্যাবে আর কখনো পাঠানো হয় না
    const later = openPage(BEST, { storage, now: 900_000 });
    expect(later.location.replaced).toEqual([]);
    // অন্য ট্যাব (নিজের sessionStorage) আলাদা
    expect(openPage(BEST, { storage: new Map(), now: 900_000 }).location.replaced).toEqual([
      SHIRTS,
    ]);
  });

  it("stops after one round trip when a best-selling link is opened in such a theme", () => {
    const storage: Storage = new Map();
    const first = openPage(BEST, { storage, now: 1000, referrer: "https://www.google.com/" });
    expect(first.location.replaced).toEqual([SHIRTS]);
    // থিম ফেরত পাঠানো পেজ থেকে আবার best-selling-এ পাঠাল; থিম ঠিকানায় নিজের কিছু যোগ করলেও চেনা যায়
    const bounced = openPage(BEST, { storage, now: 4000, referrer: `${SHIRTS}?view=grid` });
    expect(bounced.location.replaced).toEqual([]);
  });

  it("keeps redirecting a shopper whose visits do not look like a theme loop", () => {
    const storage: Storage = new Map();
    expect(openPage(BEST, { storage, now: 1000 }).location.replaced).toEqual([SHIRTS]);
    // সাথে সাথে আবার, কিন্তু অন্য কালেকশনের পেজ থেকে বা ঠিকানা লিখে
    const fromOther = openPage(BEST, {
      storage,
      now: 5000,
      referrer: "https://shop.example/collections/caps",
    });
    expect(fromOther.location.replaced).toEqual([SHIRTS]);
    // একই পেজের সাধারণ ঠিকানা থেকে, কিন্তু অনেক পরে (থিমের ঘোরানো হলে সাথে সাথে হতো)
    const muchLater = openPage(BEST, { storage, now: 60_000, referrer: SHIRTS });
    expect(muchLater.location.replaced).toEqual([SHIRTS]);
    expect(storage.get("app-bsp")).toBe("60000 3");
  });

  it("gives up after three redirects in one tab, so a loop it cannot see still ends", () => {
    const storage: Storage = new Map();
    // থিম বা ব্রাউজার আগের পেজের ঠিকানা জানায় না (referrer ফাঁকা), তাই ঘোরানোটা চেনা যায় না
    for (let round = 0; round < 3; round++) {
      const page = openPage(BEST, { storage, now: 1000 + round * 800 });
      expect(page.location.replaced, `round ${round}`).toEqual([SHIRTS]);
    }
    const fourth = openPage(BEST, { storage, now: 5000 });
    expect(fourth.location.replaced).toEqual([]);
    expect(storage.get("app-bsp")).toBe("off");
  });

  it("does not redirect when the browser blocks session storage", () => {
    const page = openPage(BEST, { storage: null, now: 1000 });
    expect(page.location.replaced).toEqual([]);
    expect(page.root.style.visibility).toBe("");
  });
});
