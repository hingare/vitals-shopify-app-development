import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop, planOf } from "../lib/shop.server";
import { syncStoreConfig } from "../lib/tools.server";
import { deleteOffer, getOffer, saveOffer } from "../lib/offers.server";
import { OFFER_TYPES, type OfferType } from "../lib/offers";
import { useT } from "../lib/i18n";

interface ProductRef {
  id: string;
  handle: string;
  title: string;
  qty?: number;
}
interface Value {
  percent?: number;
  amountEach?: number;
}
interface Tier {
  minQty: number;
  value: Value;
}
interface Draft {
  products: ProductRef[];
  tiers: Tier[];
  value: Value;
  title: string;
  message: string;
}

const EMPTY: Draft = {
  products: [],
  tiers: [
    { minQty: 2, value: { percent: 10 } },
    { minQty: 3, value: { percent: 15 } },
  ],
  value: { percent: 10 },
  title: "",
  message: "",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  if (params.id === "new") {
    const type = new URL(request.url).searchParams.get("type");
    if (!(OFFER_TYPES as readonly string[]).includes(type ?? "")) throw redirect("/app/offers");
    return { id: null, type: type as OfferType, name: "", active: true, draft: EMPTY };
  }
  const offer = await getOffer(shop.id, params.id ?? "");
  if (!offer) throw new Response("Not found", { status: 404 });
  return {
    id: offer.id,
    type: offer.type as OfferType,
    name: offer.name,
    active: offer.active,
    draft: { ...EMPTY, ...(offer.config as Partial<Draft>) },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as {
    intent?: string;
    type: OfferType;
    name: string;
    active: boolean;
    config: unknown;
  };
  const sync = () =>
    syncStoreConfig(admin, { id: shop.id, plan: planOf(shop) }).catch((error: unknown) => {
      console.warn("[offers] sync failed", error);
      return null;
    });

  if (body.intent === "delete" && params.id && params.id !== "new") {
    await deleteOffer(shop.id, params.id);
    await sync();
    return redirect("/app/offers");
  }
  const result = await saveOffer(shop.id, {
    id: params.id === "new" ? undefined : params.id,
    type: body.type,
    name: body.name,
    active: body.active,
    config: body.config,
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  const synced = await sync();
  if (params.id === "new") return redirect(`/app/offers/${result.id}?saved=1`);
  return { ok: true as const, synced: synced !== null };
};

function ValueFields({
  value,
  onChange,
  label,
}: {
  value: Value;
  onChange: (v: Value) => void;
  label: string;
}) {
  const t = useT();
  const kind = value.amountEach !== undefined ? "amount" : "percent";
  const number = kind === "amount" ? value.amountEach : value.percent;
  return (
    <s-stack direction="inline" gap="small" alignItems="end">
      <s-select
        label={t("offers.discountType")}
        value={kind}
        onChange={(e) =>
          onChange(
            e.currentTarget.value === "amount"
              ? { amountEach: number ?? 1 }
              : { percent: Math.min(number ?? 10, 100) },
          )
        }
      >
        <s-option value="percent">{t("offers.percent")}</s-option>
        <s-option value="amount">{t("offers.amountEach")}</s-option>
      </s-select>
      <s-number-field
        label={label}
        value={String(number ?? "")}
        min={0.01}
        {...(kind === "percent" ? { max: 100 } : {})}
        onChange={(e) => {
          const n = Number(e.currentTarget.value);
          onChange(kind === "amount" ? { amountEach: n } : { percent: n });
        }}
      />
    </s-stack>
  );
}

export default function OfferEditor() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [name, setName] = useState(data.name);
  const [active, setActive] = useState(data.active);
  const [draft, setDraft] = useState<Draft>(data.draft);
  const isVolume = data.type === "volume";
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("saved")) {
      shopify.toast.show(t("offers.saved"));
    }
  }, [shopify, t]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show(t("offers.saved"));
    else shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.state, fetcher.data, shopify, t]);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  async function pickProducts() {
    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: isVolume ? 100 : 5,
      selectionIds: draft.products.map((p) => ({ id: `gid://shopify/Product/${p.id}` })),
      filter: { variants: false },
    });
    if (!selected) return;
    const qty = new Map(draft.products.map((p) => [p.id, p.qty ?? 1]));
    update({
      products: selected.map((p) => {
        const id = p.id.split("/").pop()!;
        return {
          id,
          handle: p.handle,
          title: p.title,
          ...(isVolume ? {} : { qty: qty.get(id) ?? 1 }),
        };
      }),
    });
  }

  function save(intent?: string) {
    const config = isVolume
      ? { products: draft.products, tiers: draft.tiers, message: draft.message }
      : {
          products: draft.products,
          value: draft.value,
          title: draft.title,
          message: draft.message,
        };
    fetcher.submit(JSON.stringify({ intent, type: data.type, name, active, config }), {
      method: "POST",
      encType: "application/json",
    });
  }

  return (
    <s-page
      heading={
        data.id
          ? name || t(`offers.type.${data.type}`)
          : t(isVolume ? "offers.newVolume" : "offers.newBundle")
      }
    >
      <s-link slot="breadcrumb-actions" href="/app/offers">
        {t("nav.offers")}
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        {...(busy ? { loading: true } : {})}
        onClick={() => save()}
      >
        {t("offers.save")}
      </s-button>
      {data.id && (
        <s-button
          slot="secondary-actions"
          tone="critical"
          onClick={() => {
            if (window.confirm(t("offers.confirmDelete"))) save("delete");
          }}
        >
          {t("offers.delete")}
        </s-button>
      )}

      <s-section>
        <s-stack direction="block" gap="base">
          <s-text-field
            label={t("offers.name")}
            details={t("offers.nameHelp")}
            value={name}
            maxLength={120}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <s-checkbox
            label={t("offers.active")}
            checked={active}
            onChange={(e) => setActive(e.currentTarget.checked)}
          />
        </s-stack>
      </s-section>

      <s-section heading={t("offers.products")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {t(isVolume ? "offers.productsVolumeHelp" : "offers.productsBundleHelp")}
          </s-paragraph>
          {draft.products.map((p, i) => (
            <s-stack key={p.id} direction="inline" gap="small" alignItems="center">
              <s-text>{p.title}</s-text>
              {!isVolume && (
                <s-number-field
                  label={t("offers.qty")}
                  labelAccessibilityVisibility="exclusive"
                  value={String(p.qty ?? 1)}
                  min={1}
                  max={10}
                  onChange={(e) => {
                    const products = [...draft.products];
                    products[i] = { ...p, qty: Number(e.currentTarget.value) || 1 };
                    update({ products });
                  }}
                />
              )}
              <s-button
                variant="tertiary"
                onClick={() => update({ products: draft.products.filter((x) => x.id !== p.id) })}
              >
                {t("offers.remove")}
              </s-button>
            </s-stack>
          ))}
          {isVolume && draft.products.length === 0 && (
            <s-text color="subdued">{t("offers.allProducts")}</s-text>
          )}
          <s-button onClick={() => void pickProducts()}>{t("offers.chooseProducts")}</s-button>
        </s-stack>
      </s-section>

      {isVolume ? (
        <s-section heading={t("offers.tiers")}>
          <s-stack direction="block" gap="base">
            {draft.tiers.map((tier, i) => (
              <s-stack key={i} direction="inline" gap="small" alignItems="end">
                <s-number-field
                  label={t("offers.minQty")}
                  value={String(tier.minQty)}
                  min={2}
                  max={1000}
                  onChange={(e) => {
                    const tiers = [...draft.tiers];
                    tiers[i] = { ...tier, minQty: Number(e.currentTarget.value) || 2 };
                    update({ tiers });
                  }}
                />
                <ValueFields
                  label={t("offers.discount")}
                  value={tier.value}
                  onChange={(value) => {
                    const tiers = [...draft.tiers];
                    tiers[i] = { ...tier, value };
                    update({ tiers });
                  }}
                />
                {draft.tiers.length > 1 && (
                  <s-button
                    variant="tertiary"
                    onClick={() => update({ tiers: draft.tiers.filter((_, j) => j !== i) })}
                  >
                    {t("offers.remove")}
                  </s-button>
                )}
              </s-stack>
            ))}
            {draft.tiers.length < 5 && (
              <s-button
                onClick={() => {
                  const last = draft.tiers[draft.tiers.length - 1];
                  update({
                    tiers: [
                      ...draft.tiers,
                      { minQty: (last?.minQty ?? 1) + 1, value: { percent: 20 } },
                    ],
                  });
                }}
              >
                {t("offers.addTier")}
              </s-button>
            )}
          </s-stack>
        </s-section>
      ) : (
        <s-section heading={t("offers.discount")}>
          <s-stack direction="block" gap="base">
            <s-text-field
              label={t("offers.bundleTitle")}
              details={t("offers.bundleTitleHelp")}
              value={draft.title}
              maxLength={80}
              onInput={(e) => update({ title: e.currentTarget.value })}
            />
            <ValueFields
              label={t("offers.discount")}
              value={draft.value}
              onChange={(value) => update({ value })}
            />
          </s-stack>
        </s-section>
      )}

      <s-section heading={t("offers.checkoutText")}>
        <s-text-field
          label={t("offers.message")}
          details={t("offers.messageHelp")}
          value={draft.message}
          maxLength={80}
          onInput={(e) => update({ message: e.currentTarget.value })}
        />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
