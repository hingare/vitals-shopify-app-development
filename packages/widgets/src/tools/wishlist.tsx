import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { StoreConfig, ToolContext } from "../types";
import { attribute, track } from "../analytics";
import { cartPost } from "../cart-api";
import { store } from "../dom";
import { widgetT, type WidgetString } from "../i18n";
import {
  type AjaxProduct,
  fetchProduct,
  imageUrl,
  money,
  placeAfterProductForm,
  readPageProduct,
  root,
} from "../product";
import { proxyGet, proxyPost } from "../proxy";
import { buttonStyle, type Colors, Modal, overlayHost } from "../ui";

const TOOL_ID = "wishlist";
const CACHE_KEY = "app_wishlist";
const GUEST_KEY = "app_wishlist_guest";
const SYNC_KEY = "app_wishlist_synced";
/** তালিকা খুললে একসাথে এতগুলো প্রোডাক্ট আনা হয় */
const PAGE = 12;

interface Settings {
  addText: string;
  addedText: string;
  title: string;
  emptyText: string;
  showLauncher: boolean;
  launcherSide: "left" | "right";
  colors: Colors;
}

export interface WishlistItem {
  productId: string;
  handle: string;
}

interface ServerList {
  items: WishlistItem[];
  customer: boolean;
}

const isItem = (value: unknown): value is WishlistItem => {
  const item = value as WishlistItem | null;
  return (
    Boolean(item) &&
    typeof item === "object" &&
    typeof item?.productId === "string" &&
    typeof item.handle === "string"
  );
};

/**
 * ব্রাউজারে রাখা তালিকা পড়ে। তালিকাটা কার (`o`: ক্রেতার id, অতিথির জন্য ০) তা সাথে লেখা থাকে:
 * ক্রেতা লগআউট করলে বা অন্য ক্রেতা লগইন করলে আগের জনের তালিকা আর দেখানো হয় না।
 * অতিথির তালিকা লগইনের পরেও দেখায়, কারণ সার্ভার সেটা ক্রেতার তালিকায় মিশিয়ে দেয়।
 */
export function readCache(raw: string | null, customerId: number | null): WishlistItem[] {
  try {
    const cache = JSON.parse(raw ?? "null") as { o?: unknown; items?: unknown } | null;
    if (!cache || !Array.isArray(cache.items)) return [];
    const owner = typeof cache.o === "number" ? cache.o : 0;
    if (owner !== 0 && owner !== (customerId ?? 0)) return [];
    return cache.items.filter(isItem);
  } catch {
    return [];
  }
}

/** তালিকায় না থাকলে সামনে যোগ হয়, থাকলে বাদ যায় */
export function toggleItem(
  items: WishlistItem[],
  entry: WishlistItem,
): { items: WishlistItem[]; action: "add" | "remove" } {
  const rest = items.filter((item) => item.productId !== entry.productId);
  return rest.length < items.length
    ? { items: rest, action: "remove" }
    : { items: [entry, ...items], action: "add" };
}

/** অতিথির জন্য র‍্যান্ডম id (অনুমান করা যায় না, তাই অন্য কেউ এই তালিকা পড়তে পারে না) */
export function newGuestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function guestId(): string {
  let id = store.get(GUEST_KEY);
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    id = newGuestId();
    store.set(GUEST_KEY, id);
  }
  return id;
}

/** তালিকার একটাই কপি: বাটন, ভাসমান বাটন আর তালিকার জানালা সবাই এটা দেখে */
function createList(customerId: number | null) {
  const raw = store.get(CACHE_KEY);
  let items = readCache(raw, customerId);
  const listeners = new Set<() => void>();
  const guest = guestId();
  const set = (next: WishlistItem[]) => {
    items = next;
    store.set(CACHE_KEY, JSON.stringify({ o: customerId ?? 0, items }));
    for (const listener of listeners) listener();
  };
  // অন্য কারো (লগআউট হওয়া ক্রেতার) তালিকা ব্রাউজারে পড়ে থাকলে মুছে ফেলি
  if (raw && items.length === 0) set([]);
  return {
    get: () => items,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** সার্ভারের তালিকা আনে (শুধু লগইন করা ক্রেতার জন্য: অন্য ডিভাইসে যা জমানো তা-ও আসে) */
    async refresh() {
      const data = await proxyGet<ServerList>(`wishlist?g=${guest}`);
      if (!data || !Array.isArray(data.items)) return false;
      set(data.items.filter(isItem));
      return true;
    },
    async toggle(entry: WishlistItem) {
      const before = items;
      const change = toggleItem(items, entry);
      set(change.items); // সাথে সাথে দেখাই; সার্ভার না মানলে আগের অবস্থায় ফেরে
      const res = await proxyPost<ServerList>("wishlist", {
        g: guest,
        action: change.action,
        productId: entry.productId,
        handle: entry.handle,
      });
      if (!res.ok || !Array.isArray(res.data?.items)) {
        set(before);
        return false;
      }
      set(res.data.items.filter(isItem));
      if (change.action === "add") track(TOOL_ID, "click");
      return true;
    },
  };
}

type List = ReturnType<typeof createList>;

function useItems(list: List): WishlistItem[] {
  const [items, setItems] = useState(list.get);
  useEffect(() => list.subscribe(() => setItems(list.get())), []);
  return items;
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"
    >
      <path d="M12 20.5 4.2 12.7a4.9 4.9 0 0 1 6.9-6.9l.9.9.9-.9a4.9 4.9 0 0 1 6.9 6.9z" />
    </svg>
  );
}

/** প্রোডাক্ট পেজে "Add to wishlist" বাটন */
function SaveButton({ s, list, entry }: { s: Settings; list: List; entry: WishlistItem }) {
  const saved = useItems(list).some((item) => item.productId === entry.productId);
  return (
    <div style={{ margin: "12px 0" }}>
      <button
        type="button"
        aria-pressed={saved}
        onClick={() => void list.toggle(entry)}
        style={{
          ...buttonStyle(s.colors, true),
          width: "100%",
          display: "flex",
          gap: "8px",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ color: s.colors.accent, display: "flex" }}>
          <Heart filled={saved} />
        </span>
        {saved ? s.addedText : s.addText}
      </button>
    </div>
  );
}

function Row({
  item,
  s,
  list,
  config,
}: {
  item: WishlistItem;
  s: Settings;
  list: List;
  config: StoreConfig;
}) {
  const t = (key: WidgetString) => widgetT(config.locale, key);
  // undefined = আনা হচ্ছে, null = প্রোডাক্টটা এখন স্টোরে নেই
  const [product, setProduct] = useState<AjaxProduct | null | undefined>(undefined);
  const [state, setState] = useState<"" | "adding" | "added" | "failed">("");
  useEffect(() => {
    let alive = true;
    void fetchProduct(item.handle).then((found) => alive && setProduct(found));
    return () => {
      alive = false;
    };
  }, [item.handle]);
  if (!product) return null;

  const url = product.url ?? `${root()}products/${product.handle}`;
  // একটাই ভ্যারিয়েন্ট হলে এখান থেকেই কার্টে যোগ; বেশি হলে ক্রেতা প্রোডাক্ট পেজে গিয়ে বেছে নেয়
  const only = product.variants?.length === 1 ? product.variants[0] : undefined;
  async function add(variantId: number) {
    setState("adding");
    const ok = await cartPost("cart/add.js", { items: [{ id: variantId, quantity: 1 }] });
    if (ok) {
      track(TOOL_ID, "add_to_cart");
      void attribute(TOOL_ID);
    }
    setState(ok ? "added" : "failed");
  }

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "64px 1fr auto",
        gap: "12px",
        alignItems: "center",
        padding: "12px 0",
        borderTop: "1px solid rgba(0,0,0,.1)",
      }}
    >
      {product.featured_image ? (
        <img
          src={imageUrl(product.featured_image, 128)}
          alt=""
          loading="lazy"
          width={64}
          height={64}
          style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "8px" }}
        />
      ) : (
        <span />
      )}
      <div style={{ minWidth: 0 }}>
        <a href={url} style={{ color: "inherit", fontWeight: 600, textDecoration: "none" }}>
          {product.title}
        </a>
        <div style={{ color: s.colors.accent, fontWeight: 600 }}>
          {money(product.price, config.currency, config.locale)}
        </div>
        <div style={{ marginTop: "6px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {only && product.available ? (
            <button
              type="button"
              disabled={state === "adding"}
              onClick={() => void add(only.id)}
              style={{ ...buttonStyle(s.colors), padding: "8px 12px", minHeight: "36px" }}
            >
              {t(state === "adding" ? "adding" : state === "added" ? "added" : "addToCart")}
            </button>
          ) : (
            <a
              href={url}
              style={{ ...buttonStyle(s.colors, true), padding: "8px 12px", minHeight: "36px" }}
            >
              {t(product.available ? "view" : "soldOut")}
            </a>
          )}
        </div>
        {state === "failed" && (
          <p role="alert" style={{ margin: "6px 0 0", color: "#B91C1C", fontSize: "13px" }}>
            {t("cartFailed")}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label={`${t("wishlistRemove")}: ${product.title}`}
        onClick={() => void list.toggle(item)}
        style={{
          background: "none",
          border: 0,
          color: "inherit",
          fontSize: "22px",
          minWidth: "40px",
          minHeight: "40px",
          cursor: "pointer",
        }}
      >
        ×
      </button>
    </li>
  );
}

function Panel({
  s,
  list,
  config,
  onClose,
}: {
  s: Settings;
  list: List;
  config: StoreConfig;
  onClose: () => void;
}) {
  const t = (key: WidgetString) => widgetT(config.locale, key);
  const items = useItems(list);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    if (config.customerId) void list.refresh();
  }, []);
  return (
    <Modal label={s.title} colors={s.colors} onClose={onClose} closeLabel={t("close")}>
      <h2 style={{ margin: "0 0 12px", fontSize: "20px" }}>{s.title}</h2>
      {items.length === 0 ? (
        <p style={{ margin: 0 }}>{s.emptyText}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.slice(0, shown).map((item) => (
            <Row key={item.productId} item={item} s={s} list={list} config={config} />
          ))}
        </ul>
      )}
      {items.length > shown && (
        <button
          type="button"
          onClick={() => setShown(shown + PAGE)}
          style={{ ...buttonStyle(s.colors, true), width: "100%", marginTop: "12px" }}
        >
          {t("showMoreItems")}
        </button>
      )}
    </Modal>
  );
}

/** পর্দার ধারে ছোট ভাসমান বাটন: কয়টা জমানো আছে দেখায়, চাপলে তালিকা খোলে */
function Launcher({ s, list, open }: { s: Settings; list: List; open: () => void }) {
  const count = useItems(list).length;
  const left = s.launcherSide === "left";
  return (
    <button
      type="button"
      aria-label={count > 0 ? `${s.title} (${count})` : s.title}
      aria-haspopup="dialog"
      onClick={open}
      style={{
        position: "fixed",
        [left ? "left" : "right"]: 0,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 2147482350,
        width: "44px",
        minHeight: "48px",
        padding: "8px 0",
        border: 0,
        borderRadius: left ? "0 10px 10px 0" : "10px 0 0 10px",
        background: s.colors.background,
        color: s.colors.accent,
        boxShadow: "0 2px 12px rgba(0,0,0,.2)",
        cursor: "pointer",
        display: "grid",
        justifyItems: "center",
        gap: "2px",
        fontSize: "12px",
        fontWeight: 700,
        fontFamily: "inherit",
      }}
    >
      <Heart filled={count > 0} />
      {count > 0 && <span style={{ color: s.colors.text }}>{count}</span>}
    </button>
  );
}

/**
 * Wishlist: প্রোডাক্ট পেজে হার্ট বাটন, আর (চাইলে) পর্দার ধারে তালিকা খোলার বাটন।
 * অতিথির তালিকা ব্রাউজারে থাকে আর সার্ভারেও জমা হয়; লগইন করলে সেটা ক্রেতার তালিকায় মিশে যায়।
 */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const customerId = config.customerId ?? null;
  const list = createList(customerId);

  // লগইন করা ক্রেতা: প্রতি সেশনে একবার সার্ভারের তালিকা আনি (অতিথির তালিকাও তখন মিশে যায়)
  if (customerId) {
    let synced: string | null = null;
    try {
      synced = sessionStorage.getItem(SYNC_KEY);
    } catch {
      // private mode: প্রতি পেজে একবার আনা হবে
    }
    if (synced !== String(customerId)) {
      void list.refresh().then((ok) => {
        if (!ok) return;
        try {
          sessionStorage.setItem(SYNC_KEY, String(customerId));
        } catch {
          // private mode
        }
      });
    }
  }

  if (config.pageType === "product") {
    const product = readPageProduct();
    if (product?.handle) {
      const entry = { productId: String(product.productId), handle: product.handle };
      render(<SaveButton s={s} list={list} entry={entry} />, placeAfterProductForm(TOOL_ID));
    }
  }

  let isOpen = false;
  const open = () => {
    if (isOpen) return;
    isOpen = true;
    const { host, remove } = overlayHost("app-wishlist");
    const close = () => {
      isOpen = false;
      render(null, host);
      remove();
    };
    render(<Panel s={s} list={list} config={config} onClose={close} />, host);
  };
  // মার্চেন্ট নিজের মেনুতে "#wishlist" লিংক দিলে সেটাও তালিকা খোলে
  document.addEventListener("click", (event) => {
    if (!(event.target as Element | null)?.closest?.('a[href$="#wishlist"]')) return;
    event.preventDefault();
    open();
  });
  if (location.hash === "#wishlist") open();

  if (!s.showLauncher) return;
  const launcher = document.createElement("div");
  launcher.id = "app-wishlist-launcher";
  document.body.appendChild(launcher);
  render(<Launcher s={s} list={list} open={open} />, launcher);
}
