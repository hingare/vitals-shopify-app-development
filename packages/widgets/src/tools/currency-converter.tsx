import { render } from "preact";
import { useState } from "preact/hooks";
import type { StoreConfig, ToolContext } from "../types";
import { bottomOffset, fill, store } from "../dom";
import { currencyForLocale, parseMoney, replaceMoney } from "../money";

const KEY = "app_currency";
const PRICE =
  ".money, .price-item, .price__current, .product__price, .product-price, .price, [data-product-price], .cart-item__price, .totals__total-value, .cart__total, .order-summary__price";

interface Settings {
  currencies: string[];
  autoDetect: boolean;
  position: "bottom-left" | "bottom-right";
  checkoutNote: string;
  colors: { background: string; text: string; accent: string };
}

/** দামের লেখাগুলো (একই দাম দুবার না ধরতে শুধু ভেতরের দিকের element) */
function priceNodes(): Text[] {
  const nodes: Text[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(PRICE)) {
    if (el.closest("[data-app-widget='currency'], script, style")) continue;
    if (el.querySelector(PRICE)) continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/\d/.test(n.textContent ?? "")) nodes.push(n as Text);
    }
  }
  return nodes;
}

function Picker({
  s,
  config,
  current,
  choose,
}: {
  s: Settings;
  config: StoreConfig;
  current: string;
  choose: (code: string) => void;
}) {
  const [value, setValue] = useState(current);
  const side = s.position === "bottom-left" ? "left" : "right";
  const options = [...new Set([config.shopCurrency!, ...s.currencies])];
  return (
    <div
      data-app-widget="currency"
      style={{
        position: "fixed",
        [side]: "16px",
        bottom: `${16 + bottomOffset()}px`,
        zIndex: 2147482200,
        padding: "8px 10px",
        borderRadius: "10px",
        background: s.colors.background,
        color: s.colors.text,
        boxShadow: "0 4px 14px rgba(0,0,0,.18)",
        fontSize: "13px",
        maxWidth: "240px",
      }}
    >
      <select
        aria-label="Currency"
        value={value}
        onChange={(e) => {
          const code = e.currentTarget.value;
          setValue(code);
          choose(code);
        }}
        style={{ fontSize: "14px", minHeight: "36px", color: "inherit" }}
      >
        {options.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      {value !== config.shopCurrency && s.checkoutNote && (
        <p style={{ margin: "6px 0 0" }}>
          {fill(s.checkoutNote, { currency: value, shopCurrency: config.shopCurrency! })}{" "}
          <a
            href="https://www.exchangerate-api.com"
            target="_blank"
            rel="noopener"
            style={{ color: "inherit", opacity: 0.6 }}
          >
            Rates
          </a>
        </p>
      )}
    </div>
  );
}

/**
 * পেজের দাম ক্রেতার মুদ্রায় দেখায়; চেকআউট স্টোরের মুদ্রাতেই।
 * Shopify Markets একাধিক মুদ্রা দেখালে (বা কার্টের মুদ্রা আলাদা হলে) কিছুই করে না, তাই দুবার রূপান্তর হয় না।
 */
export async function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  const shop = config.shopCurrency;
  if (!shop || (config.marketsCurrencies ?? 1) > 1) return;
  if (config.currency && config.currency !== shop) return;

  const res = await fetch(`/apps/app-tools/fx?base=${shop}`).catch(() => null);
  const rates = res?.ok ? ((await res.json()) as { rates?: Record<string, number> }).rates : null;
  if (!rates) return;

  const allowed = new Set([shop, ...s.currencies.filter((c) => rates[c])]);
  const saved = store.get(KEY);
  const detected = s.autoDetect ? currencyForLocale(navigator.language) : null;
  let current =
    saved && allowed.has(saved) ? saved : detected && allowed.has(detected) ? detected : shop;

  const originals = new WeakMap<Text, string>();
  const set = (node: Text, text: string) => {
    if (node.textContent !== text) node.textContent = text;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(apply, 80);
  });
  function apply() {
    for (const node of priceNodes()) {
      const original = originals.get(node) ?? node.textContent ?? "";
      if (!originals.has(node)) originals.set(node, original);
      if (current === shop) {
        set(node, original);
        continue;
      }
      const amount = parseMoney(original, config.moneyFormat);
      if (amount === null) continue;
      try {
        const format = new Intl.NumberFormat(config.locale, {
          style: "currency",
          currency: current,
        });
        set(node, replaceMoney(original, format.format(amount * rates![current]!)));
      } catch {
        // অচেনা মুদ্রা: আসল দামই থাকে
      }
    }
    // নিজের বদলানো লেখা আবার ধরে লুপ না হয়
    observer.takeRecords();
  }

  apply();
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  const host = document.createElement("div");
  document.body.appendChild(host);
  render(
    <Picker
      s={s}
      config={config}
      current={current}
      choose={(code) => {
        current = code;
        store.set(KEY, code);
        apply();
      }}
    />,
    host,
  );
}
