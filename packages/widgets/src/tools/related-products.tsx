import { render } from "preact";
import type { ToolContext } from "../types";
import { track } from "../analytics";
import { ProductGrid } from "../grid";
import { type AjaxProduct, placeAfterProductSection, readPageProduct, root } from "../product";

const TOOL_ID = "related-products";

interface Settings {
  heading: string;
  intent: "related" | "complementary";
  limit: number;
  colors: { background: string; text: string; accent: string };
}

/** Shopify-র নিজের সুপারিশ (Search & Discovery অ্যাপে মার্চেন্ট নিজে ঠিকও করতে পারেন) */
export async function mount({ config, settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (config.pageType !== "product") return;
  const product = readPageProduct();
  if (!product) return;
  const res = await fetch(
    `${root()}recommendations/products.json?product_id=${product.productId}&limit=${s.limit}&intent=${s.intent}`,
  ).catch(() => null);
  if (!res?.ok) return;
  const { products = [] } = (await res.json()) as { products?: AjaxProduct[] };
  if (products.length === 0) return;
  track(TOOL_ID, "view");
  render(
    <ProductGrid
      toolId={TOOL_ID}
      heading={s.heading}
      products={products.slice(0, s.limit)}
      currency={config.currency}
      locale={config.locale}
      colors={s.colors}
    />,
    placeAfterProductSection(TOOL_ID),
  );
}
