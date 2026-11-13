import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { track } from "../analytics";
import { widgetT } from "../i18n";
import {
  currentVariantId,
  onVariantChange,
  type PageProduct,
  placeAfterProductForm,
  readPageProduct,
} from "../product";
import { proxyPost } from "../proxy";
import { buttonStyle, type Colors, inputStyle } from "../ui";

const TOOL_ID = "back-in-stock";

interface Settings {
  notifyText: string;
  heading: string;
  buttonText: string;
  successText: string;
  offerNewsletter: boolean;
  newsletterText: string;
  colors: Colors;
}

/**
 * এই ভ্যারিয়েন্ট এখন কেনা যায় না কিনা। পেজের `inventory`-তে শুধু সেই ভ্যারিয়েন্টগুলো থাকে যাদের
 * স্টক Shopify গোনে আর স্টক শেষে বিক্রি বন্ধ; সেখানে ০ বা কম মানেই স্টক শেষ।
 */
export function isSoldOut(inventory: Record<string, number> | undefined, variantId: string) {
  const quantity = inventory?.[variantId];
  return typeof quantity === "number" && quantity <= 0;
}

function NotifyForm({ s, product, locale }: { s: Settings; product: PageProduct; locale: string }) {
  const read = () => currentVariantId(product.variantId);
  const [variantId, setVariantId] = useState(read);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  // এই পেজে যেসব ভ্যারিয়েন্টের জন্য ইমেইল দেওয়া হয়ে গেছে (ভ্যারিয়েন্ট বদলে ফিরলেও ফর্ম আবার আসে না)
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState("");
  const soldOut = isSoldOut(product.inventory, variantId);

  useEffect(
    () =>
      onVariantChange(() => {
        setVariantId(read());
        setError("");
      }),
    [],
  );
  useEffect(() => {
    if (soldOut) track(TOOL_ID, "view");
  }, [soldOut]);

  if (!soldOut) return null;

  async function submit(event: Event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const askedFor = variantId;
    setSending(true);
    setError("");
    const result = await proxyPost<{ ok: boolean }>("back-in-stock", {
      productId: product.productId,
      variantId: askedFor,
      email: String(data.get("email") ?? "").trim(),
      newsletter: data.get("newsletter") === "on",
    });
    setSending(false);
    if (result.ok) {
      track(TOOL_ID, "click");
      setDone((list) => [...list, askedFor]);
      return;
    }
    setError(widgetT(locale, result.status === 429 ? "tooMany" : "tryAgain"));
  }

  const box = {
    margin: "12px 0",
    padding: open ? "14px" : 0,
    borderRadius: "10px",
    background: open ? s.colors.background : "none",
    color: s.colors.text,
    border: open ? "1px solid rgba(0,0,0,.12)" : 0,
  };

  if (done.includes(variantId)) {
    return (
      <div style={{ ...box, padding: "14px", background: s.colors.background }} role="status">
        {s.successText}
      </div>
    );
  }
  if (!open) {
    return (
      <div style={box}>
        <button
          type="button"
          style={{ ...buttonStyle(s.colors, true), width: "100%" }}
          onClick={() => setOpen(true)}
        >
          {s.notifyText}
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} style={{ ...box, display: "grid", gap: "10px" }}>
      <strong>{s.heading}</strong>
      <input
        type="email"
        name="email"
        required
        autoComplete="email"
        autoFocus
        aria-label={widgetT(locale, "emailPlaceholder")}
        placeholder={widgetT(locale, "emailPlaceholder")}
        style={inputStyle}
      />
      {s.offerNewsletter && (
        <label style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "14px" }}>
          {/* আগে থেকে টিক দেওয়া নয়: নিউজলেটারে রাজি হওয়া ক্রেতার নিজের সিদ্ধান্ত */}
          <input type="checkbox" name="newsletter" style={{ marginTop: "3px" }} />
          <span>{s.newsletterText}</span>
        </label>
      )}
      <button type="submit" disabled={sending} style={buttonStyle(s.colors)}>
        {s.buttonText}
      </button>
      {error && (
        <p role="alert" style={{ margin: 0, color: "#B91C1C" }}>
          {error}
        </p>
      )}
    </form>
  );
}

/** স্টক-শেষ ভ্যারিয়েন্টে "স্টকে এলে জানাও" বাটন; ভ্যারিয়েন্ট বদলালে নিজে থেকেই দেখায় বা লুকায় */
export function mount({ config, settings }: ToolContext) {
  if (config.pageType !== "product") return;
  const product = readPageProduct();
  if (!product?.inventory) return;
  // কোনো ভ্যারিয়েন্টেরই স্টক শেষ না হলে কিছু বসানোর দরকার নেই
  if (!Object.values(product.inventory).some((quantity) => quantity <= 0)) return;
  render(
    <NotifyForm s={settings as unknown as Settings} product={product} locale={config.locale} />,
    placeAfterProductForm(TOOL_ID),
  );
}
