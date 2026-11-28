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
import { identifyVisitor } from "../visitor";
import { adopt, takeTap } from "../early/run";
import { isSoldOut, notifyBox, notifyButton } from "../early/notify";

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

export { isSoldOut };

function NotifyForm({
  s,
  product,
  locale,
  opened = false,
}: {
  s: Settings;
  product: PageProduct;
  locale: string;
  /** early.ts-এর বাটন ফাইল আসার আগেই চাপা হয়েছিল */
  opened?: boolean;
}) {
  const read = () => currentVariantId(product.variantId);
  const [variantId, setVariantId] = useState(read);
  const [open, setOpen] = useState(opened);
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
    const email = String(data.get("email") ?? "").trim();
    setSending(true);
    setError("");
    const result = await proxyPost<{ ok: boolean }>("back-in-stock", {
      productId: product.productId,
      variantId: askedFor,
      email,
      newsletter: data.get("newsletter") === "on",
    });
    setSending(false);
    if (result.ok) {
      track(TOOL_ID, "click");
      void identifyVisitor({ email });
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
    // early.ts-এর বাটনের মতো হুবহু (early/notify.ts), যাতে টুল এসে বদলালে পাতা না সরে
    return (
      <div style={notifyBox(s)}>
        <button type="button" style={notifyButton(s)} onClick={() => setOpen(true)}>
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

/**
 * স্টক-শেষ ভ্যারিয়েন্টে "স্টকে এলে জানাও" বাটন; ভ্যারিয়েন্ট বদলালে নিজে থেকেই দেখায় বা লুকায়।
 * বেছে রাখা ভ্যারিয়েন্টের স্টক শেষ হলে বাটনটা early.ts পাতা আঁকার আগেই বসায়; এখানে একই বাটন বসে।
 */
export function mount({ config, settings }: ToolContext) {
  if (config.pageType !== "product") return;
  const product = readPageProduct();
  if (!product?.inventory) return;
  // কোনো ভ্যারিয়েন্টেরই স্টক শেষ না হলে কিছু বসানোর দরকার নেই
  if (!Object.values(product.inventory).some((quantity) => quantity <= 0)) return;
  const early = adopt(TOOL_ID);
  // early.ts-এর বাটন বদলে Preact-এর একই রকম বাটন বসে: আগে চাপা হয়ে থাকলে ফর্ম খোলা অবস্থায়, শুধু ফোকাস
  // থাকলে ফোকাস নতুন বাটনে (কীবোর্ডে থাকা ক্রেতা জায়গা না হারান)
  const tapped = early ? takeTap(early) !== null : false;
  const focused = early?.contains(document.activeElement) ?? false;
  const host = early ?? placeAfterProductForm(TOOL_ID);
  host.replaceChildren();
  render(
    <NotifyForm
      s={settings as unknown as Settings}
      product={product}
      locale={config.locale}
      opened={tapped}
    />,
    host,
  );
  if (tapped) host.querySelector("input")?.focus();
  else if (focused) host.querySelector("button")?.focus();
}
