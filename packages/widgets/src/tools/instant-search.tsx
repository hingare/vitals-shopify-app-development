import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { attribute, track } from "../analytics";
import { cartPost } from "../cart-api";
import { fill, isMobile, store } from "../dom";
import { widgetT, type WidgetString } from "../i18n";
import { imageUrl, money, root } from "../product";
import type { StoreConfig, ToolContext } from "../types";
import { buttonStyle, type Colors } from "../ui";

/**
 * Instant Search: স্টোরের সার্চ ঘরে ক্লিক করলে উপরে একটা খোঁজার প্যানেল খোলে, আর টাইপ করতেই
 * প্রোডাক্ট, কালেকশন আর পেজ দেখায়। ফল আসে Shopify-র নিজের predictive search থেকে
 * (আমাদের সার্ভারে কিছু যায় না), তাই থিমের সার্চ সেটিংস আর অনুবাদ মেনেই চলে।
 */
const TOOL_ID = "instant-search";
const HOST_ID = "app-instant-search";
const RECENT_KEY = "app_recent_searches";
const RECENT_MAX = 5;
const DEBOUNCE_MS = 180;

interface Settings {
  placeholder: string;
  limit: number;
  showPrices: boolean;
  showCollections: boolean;
  showPages: boolean;
  popularSearches: string;
  colors: Colors;
}

export interface Hit {
  title: string;
  url: string;
}

export interface ProductHit extends Hit {
  image: string | null;
  /** সেন্টে, ক্রেতার মুদ্রায় */
  price: number;
  compareAt: number;
  available: boolean;
  /** একটাই ভ্যারিয়েন্ট আর সেটা স্টকে থাকলে তার id: প্যানেল থেকেই কার্টে যোগ করা যায় */
  variantId: number | null;
}

export interface Results {
  queries: Hit[];
  products: ProductHit[];
  collections: Hit[];
  pages: Hit[];
}

/** কমা দিয়ে লেখা তালিকা: ফাঁকা বাদ, একই কথা একবার */
export function splitList(text: string, max = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const item = raw.trim().slice(0, 60);
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    out.push(item);
  }
  return out.slice(0, max);
}

/** সাম্প্রতিক খোঁজের সামনে বসায়; একই কথা আগে থাকলে সেটা সরে যায় */
export function pushRecent(list: string[], query: string): string[] {
  const q = query.trim().slice(0, 60);
  if (!q) return list;
  return [q, ...list.filter((item) => item.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
}

export function readRecent(raw: string | null): string[] {
  try {
    const list = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(list)
      ? list.filter((item): item is string => typeof item === "string").slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Shopify predictive search-এর ঠিকানা (প্রতিটা ধরনের জন্য আলাদা করে `limit`টা ফল) */
export function suggestUrl(
  base: string,
  query: string,
  s: Pick<Settings, "limit" | "showCollections" | "showPages">,
): string {
  const types = ["query", "product"];
  if (s.showCollections) types.push("collection");
  if (s.showPages) types.push("page");
  const params = new URLSearchParams({
    q: query,
    "resources[type]": types.join(","),
    "resources[limit]": String(Math.min(10, Math.max(1, Math.round(s.limit) || 6))),
    "resources[limit_scope]": "each",
    "resources[options][unavailable_products]": "last",
  });
  return `${base}search/suggest.json?${params.toString()}`;
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
/** দাম আসে দশমিকে ("19.90"), দেখানোর জন্য সেন্টে নিই */
const cents = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
};
/** শুধু এই স্টোরের ভেতরের পথ ("/products/..."); অন্য সাইটের লিংক বাদ */
const localPath = (value: unknown) => {
  const url = str(value);
  return url.startsWith("/") && !url.startsWith("//") ? url : "";
};

type Raw = Record<string, unknown>;

/** Shopify-র উত্তর থেকে যতটুকু দরকার; অচেনা বা ভাঙা অংশ চুপচাপ বাদ যায় */
export function parseResults(json: unknown): Results {
  const results = ((json as { resources?: { results?: Raw } } | null)?.resources?.results ??
    {}) as Raw;
  const list = (key: string) =>
    (Array.isArray(results[key]) ? (results[key] as unknown[]) : []).filter(
      (item): item is Raw => Boolean(item) && typeof item === "object",
    );
  const links = (key: string, titleKey = "title") =>
    list(key)
      .map((item) => ({ title: str(item[titleKey]), url: localPath(item.url) }))
      .filter((hit) => hit.title && hit.url);
  const products = list("products")
    .map((item): ProductHit => {
      const variants = Array.isArray(item.variants) ? (item.variants as Raw[]) : [];
      const only = variants.length === 1 && variants[0]?.available === true ? variants[0].id : null;
      const featured = (item.featured_image as Raw | null | undefined)?.url;
      return {
        title: str(item.title),
        url: localPath(item.url),
        image: str(featured) || str(item.image) || null,
        price: cents(item.price),
        compareAt: cents(item.compare_at_price_min),
        available: item.available !== false,
        variantId: typeof only === "number" && Number.isInteger(only) && only > 0 ? only : null,
      };
    })
    .filter((hit) => hit.title && hit.url);
  return {
    queries: links("queries", "text"),
    products,
    collections: links("collections"),
    pages: links("pages"),
  };
}

/** থিমের সার্চ ঘর: নাম q আর ফর্ম /search-এ যায়, বা type="search"। পেজের মূল অংশের সার্চ বাদ (যেমন সার্চ পেজ নিজেই) */
function isSearchInput(el: EventTarget | null): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement) || el.closest(`#${HOST_ID}, main`)) return false;
  if (el.type === "search") return true;
  return el.name === "q" && /\/search\/?(\?|$)/.test(el.form?.getAttribute("action") ?? "");
}

/** থিমের সার্চ বাটন: সার্চ পেজের লিংক, Dawn ধরনের থিমের সার্চ আইকন, বা মার্চেন্টের নিজের চিহ্ন */
const TRIGGERS = 'a[href$="/search"], .header__search summary, [data-app-search]';

const cache = new Map<string, Results>();

function Heading({ text }: { text: string }) {
  return (
    <h3
      style={{ margin: "16px 0 6px", fontSize: "12px", textTransform: "uppercase", opacity: 0.65 }}
    >
      {text}
    </h3>
  );
}

const chip = {
  border: "1px solid rgba(0,0,0,.15)",
  borderRadius: "16px",
  padding: "6px 12px",
  background: "none",
  color: "inherit",
  font: "inherit",
  fontSize: "14px",
  cursor: "pointer",
};

function Chips({ items, pick }: { items: string[]; pick: (value: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      {items.map((item) => (
        <button key={item} type="button" data-nav onClick={() => pick(item)} style={chip}>
          {item}
        </button>
      ))}
    </div>
  );
}

function AddButton({ variantId, t, colors }: { variantId: number; t: T; colors: Colors }) {
  const [state, setState] = useState<"" | "busy" | "done" | "failed">("");
  async function add() {
    setState("busy");
    const ok = await cartPost("cart/add.js", { items: [{ id: variantId, quantity: 1 }] });
    if (ok) {
      track(TOOL_ID, "add_to_cart");
      void attribute(TOOL_ID);
    }
    setState(ok ? "done" : "failed");
  }
  return (
    <button
      type="button"
      data-nav
      onClick={() => void add()}
      disabled={state === "busy" || state === "done"}
      style={{ ...buttonStyle(colors), padding: "6px 14px", minHeight: "36px", fontSize: "14px" }}
    >
      {state === "busy"
        ? t("adding")
        : state === "done"
          ? t("added")
          : state === "failed"
            ? t("tryAgain")
            : t("add")}
    </button>
  );
}

type T = (key: WidgetString) => string;

function SearchPanel({
  s,
  t,
  config,
  initial,
  onClose,
}: {
  s: Settings;
  t: T;
  config: StoreConfig;
  initial: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState(() => readRecent(store.get(RECENT_KEY)));
  const panel = useRef<HTMLDivElement>(null);
  const q = query.trim();
  const currency = window.Shopify?.currency?.active || config.currency;
  const format = (amount: number) => money(amount, currency, config.locale);
  const mobile = isMobile();

  useEffect(() => {
    track(TOOL_ID, "view");
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!q) {
      setResults(null);
      setLoading(false);
      return;
    }
    const known = cache.get(q.toLowerCase());
    if (known) {
      setResults(known);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(suggestUrl(root(), q, s), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      })
        .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
        .then((json) => {
          const found = json ? parseResults(json) : null;
          if (found) cache.set(q.toLowerCase(), found);
          setResults(found);
          setLoading(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  const remember = () => {
    const next = pushRecent(recent, q);
    setRecent(next);
    store.set(RECENT_KEY, JSON.stringify(next));
  };
  const chosen = () => {
    remember();
    track(TOOL_ID, "click");
  };
  const clearRecent = () => {
    setRecent([]);
    store.set(RECENT_KEY, "[]");
  };

  /** উপর-নিচ তীর দিয়ে ঘর থেকে ফলে, ফল থেকে ফলে */
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>("[data-nav]") ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  const popular = splitList(s.popularSearches);
  const allUrl = `${root()}search?q=${encodeURIComponent(q)}&options%5Bprefix%5D=last`;
  const empty =
    results &&
    !results.products.length &&
    !results.collections.length &&
    !results.pages.length &&
    !results.queries.length;
  const linkStyle = {
    color: "inherit",
    textDecoration: "none",
    display: "block",
    padding: "6px 0",
  };

  return (
    <div
      onClick={(event) => event.target === event.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483000,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t("searchLabel")}
        onKeyDown={onKeyDown}
        style={{
          width: "100%",
          maxWidth: mobile ? "none" : "680px",
          height: mobile ? "100%" : "auto",
          maxHeight: mobile ? "none" : "80vh",
          marginTop: mobile ? 0 : "8vh",
          borderRadius: mobile ? 0 : "12px",
          background: s.colors.background,
          color: s.colors.text,
          boxShadow: "0 10px 40px rgba(0,0,0,.25)",
          display: "flex",
          flexDirection: "column",
          fontSize: "15px",
          lineHeight: 1.4,
          boxSizing: "border-box",
        }}
      >
        <form
          role="search"
          action={`${root()}search`}
          method="get"
          onSubmit={remember}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 8px 8px 16px",
            borderBottom: "1px solid rgba(0,0,0,.1)",
          }}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            data-nav
            type="search"
            name="q"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder={s.placeholder}
            aria-label={t("searchLabel")}
            autocomplete="off"
            enterKeyHint="search"
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: "44px",
              border: 0,
              outline: "none",
              background: "none",
              color: "inherit",
              // ১৬px-এর কম হলে iPhone জুম করে
              fontSize: "16px",
              fontFamily: "inherit",
            }}
          />
          <input type="hidden" name="options[prefix]" value="last" />
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            style={{
              background: "none",
              border: 0,
              color: "inherit",
              fontSize: "26px",
              minWidth: "44px",
              minHeight: "44px",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </form>
        <div
          aria-live="polite"
          aria-busy={loading}
          style={{ overflowY: "auto", padding: "0 16px 16px" }}
        >
          {!q ? (
            <>
              {recent.length > 0 && (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                    }}
                  >
                    <Heading text={t("searchRecent")} />
                    <button
                      type="button"
                      onClick={clearRecent}
                      style={{ ...chip, border: 0, padding: "4px", textDecoration: "underline" }}
                    >
                      {t("searchClear")}
                    </button>
                  </div>
                  <Chips items={recent} pick={setQuery} />
                </>
              )}
              {popular.length > 0 && (
                <>
                  <Heading text={t("searchPopular")} />
                  <Chips items={popular} pick={setQuery} />
                </>
              )}
            </>
          ) : (
            <>
              {results && results.queries.length > 0 && (
                <>
                  <Heading text={t("searchSuggestions")} />
                  <Chips
                    items={results.queries
                      .map((hit) => hit.title)
                      .filter((text) => text.toLowerCase() !== q.toLowerCase())
                      .slice(0, 4)}
                    pick={setQuery}
                  />
                </>
              )}
              {results && results.products.length > 0 && (
                <>
                  <Heading text={t("searchProducts")} />
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {results.products.map((hit) => (
                      <li
                        key={hit.url}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "6px 0",
                        }}
                      >
                        <a
                          data-nav
                          href={hit.url}
                          onClick={chosen}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            flex: 1,
                            minWidth: 0,
                            color: "inherit",
                            textDecoration: "none",
                          }}
                        >
                          {hit.image ? (
                            <img
                              src={imageUrl(hit.image, 120)}
                              alt=""
                              width={56}
                              height={56}
                              loading="lazy"
                              style={{
                                width: "56px",
                                height: "56px",
                                objectFit: "cover",
                                borderRadius: "6px",
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <span style={{ width: "56px", flexShrink: 0 }} />
                          )}
                          <span style={{ minWidth: 0 }}>
                            <span
                              style={{
                                display: "block",
                                fontWeight: 600,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {hit.title}
                            </span>
                            {s.showPrices && hit.price > 0 && (
                              <span>
                                {format(hit.price)}
                                {hit.compareAt > hit.price && (
                                  <s style={{ marginLeft: "6px", opacity: 0.6 }}>
                                    {format(hit.compareAt)}
                                  </s>
                                )}
                              </span>
                            )}
                            {!hit.available && (
                              <span style={{ marginLeft: "8px", opacity: 0.7 }}>
                                {t("soldOut")}
                              </span>
                            )}
                          </span>
                        </a>
                        {hit.variantId && (
                          <AddButton variantId={hit.variantId} t={t} colors={s.colors} />
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {results &&
                (
                  [
                    ["searchCollections", results.collections],
                    ["searchPages", results.pages],
                  ] as const
                ).map(
                  ([label, hits]) =>
                    hits.length > 0 && (
                      <div key={label}>
                        <Heading text={t(label)} />
                        {hits.map((hit) => (
                          <a
                            key={hit.url}
                            data-nav
                            href={hit.url}
                            onClick={chosen}
                            style={linkStyle}
                          >
                            {hit.title}
                          </a>
                        ))}
                      </div>
                    ),
                )}
              {empty && !loading && (
                <p style={{ margin: "16px 0 0" }}>{fill(t("searchNone"), { q })}</p>
              )}
              {(results || !loading) && (
                <a
                  data-nav
                  href={allUrl}
                  onClick={chosen}
                  style={{ ...buttonStyle(s.colors, true), display: "block", marginTop: "16px" }}
                >
                  {fill(t("searchAll"), { q })}
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const t: T = (key) => widgetT(config.locale, key);
  let host: HTMLElement | null = null;
  let returnTo: HTMLElement | null = null;
  let quietUntil = 0;
  let overflow = "";

  const close = () => {
    if (!host) return;
    render(null, host);
    host.remove();
    host = null;
    document.documentElement.style.overflow = overflow;
    // থিমের সার্চ ঘরে ফোকাস ফিরলে প্যানেল আবার খুলে যেত, তাই কিছুক্ষণ চুপ
    quietUntil = Date.now() + 500;
    returnTo?.focus?.();
    returnTo = null;
  };

  const open = (initial: string, from: HTMLElement | null) => {
    if (host) return;
    returnTo = from;
    host = document.createElement("div");
    host.id = HOST_ID;
    document.body.appendChild(host);
    overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    render(<SearchPanel s={s} t={t} config={config} initial={initial} onClose={close} />, host);
    // একই ক্লিকের ভেতরেই ফোকাস দিতে হয়, নইলে ফোনে কিবোর্ড ওঠে না
    host.querySelector<HTMLInputElement>("input[name=q]")?.focus();
  };

  // capture: থিমের নিজের সার্চ ড্রপডাউন বা ড্রয়ার খোলার আগেই
  document.addEventListener(
    "focus",
    (event) => {
      if (host || Date.now() < quietUntil || !isSearchInput(event.target)) return;
      const input = event.target;
      input.blur();
      open(input.value, null);
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      if (host) return;
      const trigger = (event.target as Element | null)?.closest?.<HTMLElement>(TRIGGERS);
      if (!trigger || trigger.closest(`#${HOST_ID}`)) return;
      event.preventDefault();
      event.stopPropagation();
      open("", trigger);
    },
    true,
  );
}
