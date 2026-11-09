import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  useAppMetafields,
  useApplyCartLinesChange,
  useAttributeValues,
  useCartLines,
} from "@shopify/ui-extensions/checkout/preact";
import { discountedPrice, pickOffer, readOffers } from "./offers";

export default function extension() {
  render(<Extension />, document.body);
}

interface Product {
  id: string;
  title: string;
  featuredImage: { url: string } | null;
  variants: {
    nodes: Array<{
      id: string;
      title: string;
      availableForSale: boolean;
      price: { amount: string };
    }>;
  };
}

const PRODUCTS = `query UpsellProducts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      title
      featuredImage { url(transform: { maxWidth: 160 }) }
      variants(first: 20) { nodes { id title availableForSale price { amount } } }
    }
  }
}`;

function Extension() {
  const t = shopify.i18n.translate;
  const [entry] = useAppMetafields({ namespace: "$app:checkout", key: "offers", type: "shop" });
  const lines = useCartLines();
  const [abGroup] = useAttributeValues(["_app_ab"]);
  const applyChange = useApplyCartLinesChange();
  const [products, setProducts] = useState<Product[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(false);

  const cartGids = lines.map((l) => l.merchandise.product.id);
  const pick = pickOffer(
    readOffers(entry?.metafield.value),
    cartGids,
    new Date().toISOString().slice(0, 10),
    abGroup,
  );
  const idsKey = pick?.productIds.join(",") ?? "";

  useEffect(() => {
    if (!idsKey) return setProducts([]);
    let live = true;
    void shopify
      .query<{ nodes: Array<Product | null> }>(PRODUCTS, { variables: { ids: idsKey.split(",") } })
      .then(({ data }) => {
        if (!live) return;
        setProducts(
          (data?.nodes ?? []).filter(
            (p): p is Product => !!p?.id && p.variants.nodes.some((v) => v.availableForSale),
          ),
        );
      });
    return () => {
      live = false;
    };
  }, [idsKey]);

  if (!pick || products.length === 0 || !shopify.instructions.value.lines.canAddCartLine) {
    return null;
  }

  async function add(variantId: string) {
    setBusy(variantId);
    setError(false);
    const result = await applyChange({
      type: "addCartLine",
      merchandiseId: variantId,
      quantity: 1,
    });
    setBusy("");
    if (result.type === "error") setError(true);
  }

  return (
    <s-stack gap="base">
      <s-heading>{pick.offer.title || t("heading")}</s-heading>
      {error && <s-banner tone="critical">{t("error")}</s-banner>}
      {products.map((product) => {
        const variants = product.variants.nodes.filter((v) => v.availableForSale);
        const variant = variants.find((v) => v.id === chosen[product.id]) ?? variants[0];
        if (!variant) return null;
        const price = Number(variant.price.amount);
        const sale = discountedPrice(pick.offer, price);
        return (
          <s-grid
            key={product.id}
            gridTemplateColumns="64px 1fr auto"
            gap="base"
            alignItems="center"
          >
            <s-product-thumbnail src={product.featuredImage?.url ?? ""} alt={product.title} />
            <s-stack gap="small-200">
              <s-text type="strong">{product.title}</s-text>
              <s-stack direction="inline" gap="small-200">
                {sale !== null && sale < price ? (
                  <>
                    <s-text>{shopify.i18n.formatCurrency(sale)}</s-text>
                    <s-text color="subdued">
                      <s>{shopify.i18n.formatCurrency(price)}</s>
                    </s-text>
                  </>
                ) : (
                  <s-text>{shopify.i18n.formatCurrency(price)}</s-text>
                )}
              </s-stack>
              {variants.length > 1 && (
                <s-select
                  label={t("variant")}
                  value={variant.id}
                  onChange={(e) =>
                    setChosen({
                      ...chosen,
                      [product.id]: (e.currentTarget as HTMLSelectElement | null)?.value ?? "",
                    })
                  }
                >
                  {variants.map((v) => (
                    <s-option key={v.id} value={v.id}>
                      {v.title}
                    </s-option>
                  ))}
                </s-select>
              )}
            </s-stack>
            <s-button
              variant="secondary"
              loading={busy === variant.id}
              disabled={busy !== ""}
              onClick={() => void add(variant.id)}
            >
              {busy === variant.id ? t("adding") : t("add")}
            </s-button>
          </s-grid>
        );
      })}
    </s-stack>
  );
}
