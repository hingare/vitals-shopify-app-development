import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { track } from "../analytics";
import { fill } from "../dom";
import {
  currentVariantId,
  onVariantChange,
  type PageProduct,
  placeAfterProductForm,
  readPageProduct,
} from "../product";

const TOOL_ID = "stock-scarcity";

interface Settings {
  threshold: number;
  stockMessage: string;
  showBar: boolean;
  colors: { background: string; text: string; accent: string };
}

/** দেখানোর মতো কম স্টক হলে সংখ্যাটা, নইলে null */
export function lowStock(
  inventory: Record<string, number> | undefined,
  variantId: string,
  threshold: number,
): number | null {
  const qty = inventory?.[variantId];
  return typeof qty === "number" && qty > 0 && qty <= threshold ? qty : null;
}

function Scarcity({ s, product }: { s: Settings; product: PageProduct }) {
  const read = () => lowStock(product.inventory, currentVariantId(product.variantId), s.threshold);
  const [qty, setQty] = useState(read);
  useEffect(() => onVariantChange(() => setQty(read())), []);
  if (qty === null) return null;
  return (
    <div
      style={{
        margin: "12px 0",
        padding: "8px 0",
        background: s.colors.background,
        color: s.colors.text,
        fontWeight: 600,
      }}
    >
      <p style={{ margin: 0 }}>{fill(s.stockMessage, { n: qty })}</p>
      {s.showBar && (
        <div
          aria-hidden="true"
          style={{
            height: "6px",
            marginTop: "6px",
            borderRadius: "3px",
            background: "rgba(0,0,0,.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.max(8, (qty / s.threshold) * 100)}%`,
              height: "100%",
              background: s.colors.accent,
            }}
          />
        </div>
      )}
    </div>
  );
}

/** স্টক কম থাকলে "আর মাত্র ৩টা" (ভেরিয়েন্ট বদলালে সাথে সাথে বদলায়) */
export function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType !== "product") return;
  const product = readPageProduct();
  if (!product?.inventory || Object.keys(product.inventory).length === 0) return;
  track(TOOL_ID, "view");
  render(<Scarcity s={s} product={product} />, placeAfterProductForm(TOOL_ID));
}
