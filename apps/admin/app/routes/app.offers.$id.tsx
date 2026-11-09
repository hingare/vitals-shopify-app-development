import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop, planOf } from "../lib/shop.server";
import { syncStoreConfig } from "../lib/tools.server";
import { deleteOffer, getOffer, saveOffer } from "../lib/offers.server";
import {
  AB_GROUPS,
  AUDIENCES,
  DEFAULT_LABELS,
  OFFER_TYPES,
  type AbGroup,
  type Audience,
  type OfferType,
} from "../lib/offers";
import { useT } from "../lib/i18n";

interface ProductRef {
  id: string;
  handle: string;
  title: string;
  qty?: number;
}
interface VariantRef {
  id: string;
  productId: string;
  handle: string;
  title: string;
}
interface Value {
  percent?: number;
  amountEach?: number;
}
interface Tier {
  minQty: number;
  value: Value;
}
interface Rules {
  startsOn: string;
  endsOn: string;
  minSubtotal: number;
  audience: Audience;
  customerTags: string[];
  countries: string[];
  abGroup: AbGroup;
  priority: number;
}
interface Draft {
  products: ProductRef[];
  tiers: Tier[];
  value: Value;
  title: string;
  message: string;
  rules: Rules;
  minQty: number;
  gift: VariantRef | null;
  giftQty: number;
  progressText: string;
  buyProducts: ProductRef[];
  buyQty: number;
  getProducts: ProductRef[];
  getQty: number;
  maxUses: number;
}

const RULES: Rules = {
  startsOn: "",
  endsOn: "",
  minSubtotal: 0,
  audience: "all",
  customerTags: [],
  countries: [],
  abGroup: "",
  priority: 0,
};

function emptyDraft(type: OfferType): Draft {
  return {
    products: [],
    tiers: [
      { minQty: 2, value: { percent: 10 } },
      { minQty: 3, value: { percent: 15 } },
    ],
    value: type === "bogo" ? { percent: 100 } : { percent: 10 },
    title: "",
    message: DEFAULT_LABELS[type],
    rules: type === "gift" ? { ...RULES, minSubtotal: 50 } : RULES,
    minQty: 1,
    gift: null,
    giftQty: 1,
    progressText: "",
    buyProducts: [],
    buyQty: 1,
    getProducts: [],
    getQty: 1,
    maxUses: 1,
  };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  if (params.id === "new") {
    const type = new URL(request.url).searchParams.get("type");
    if (!(OFFER_TYPES as readonly string[]).includes(type ?? "")) throw redirect("/app/offers");
    const t = type as OfferType;
    return { id: null, type: t, name: "", active: true, draft: emptyDraft(t) };
  }
  const offer = await getOffer(shop.id, params.id ?? "");
  if (!offer) throw new Response("Not found", { status: 404 });
  const type = offer.type as OfferType;
  const saved = offer.config as Partial<Draft>;
  return {
    id: offer.id,
    type,
    name: offer.name,
    active: offer.active,
    draft: {
      ...emptyDraft(type),
      ...saved,
      // আগের অফারে লেবেল খালি থাকলে যা দেখাত সেটাই দেখাই
      message: saved.message || DEFAULT_LABELS[type],
      rules: { ...RULES, ...saved.rules },
    },
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
  if (!(OFFER_TYPES as readonly string[]).includes(body.type)) {
    return { ok: false as const, error: "Unknown offer type" };
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

function ProductList({
  products,
  onChange,
  withQty,
  emptyText,
  max,
}: {
  products: ProductRef[];
  onChange: (p: ProductRef[]) => void;
  withQty?: boolean;
  emptyText?: string;
  max: number;
}) {
  const t = useT();
  const shopify = useAppBridge();

  async function pick() {
    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: max,
      selectionIds: products.map((p) => ({ id: `gid://shopify/Product/${p.id}` })),
      filter: { variants: false },
    });
    if (!selected) return;
    const qty = new Map(products.map((p) => [p.id, p.qty ?? 1]));
    onChange(
      selected.map((p) => {
        const id = p.id.split("/").pop()!;
        return {
          id,
          handle: p.handle,
          title: p.title,
          ...(withQty ? { qty: qty.get(id) ?? 1 } : {}),
        };
      }),
    );
  }

  return (
    <s-stack direction="block" gap="small">
      {products.map((p, i) => (
        <s-stack key={p.id} direction="inline" gap="small" alignItems="center">
          <s-text>{p.title}</s-text>
          {withQty && (
            <s-number-field
              label={t("offers.qty")}
              labelAccessibilityVisibility="exclusive"
              value={String(p.qty ?? 1)}
              min={1}
              max={10}
              onChange={(e) => {
                const next = [...products];
                next[i] = { ...p, qty: Number(e.currentTarget.value) || 1 };
                onChange(next);
              }}
            />
          )}
          <s-button
            variant="tertiary"
            onClick={() => onChange(products.filter((x) => x.id !== p.id))}
          >
            {t("offers.remove")}
          </s-button>
        </s-stack>
      ))}
      {products.length === 0 && emptyText && <s-text color="subdued">{emptyText}</s-text>}
      <s-button onClick={() => void pick()}>{t("offers.chooseProducts")}</s-button>
    </s-stack>
  );
}

const list = (text: string) =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function RulesSection({ rules, onChange }: { rules: Rules; onChange: (r: Rules) => void }) {
  const t = useT();
  const set = (patch: Partial<Rules>) => onChange({ ...rules, ...patch });
  const [tags, setTags] = useState(rules.customerTags.join(", "));
  const [countries, setCountries] = useState(rules.countries.join(", "));
  return (
    <s-section heading={t("offers.rules")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("offers.rulesHelp")}</s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-date-field
            label={t("offers.startsOn")}
            value={rules.startsOn}
            onChange={(e) => set({ startsOn: e.currentTarget.value })}
          />
          <s-date-field
            label={t("offers.endsOn")}
            value={rules.endsOn}
            onChange={(e) => set({ endsOn: e.currentTarget.value })}
          />
        </s-stack>
        <s-number-field
          label={t("offers.minSubtotal")}
          details={t("offers.minSubtotalHelp")}
          value={String(rules.minSubtotal)}
          min={0}
          onChange={(e) => set({ minSubtotal: Math.max(0, Number(e.currentTarget.value) || 0) })}
        />
        <s-select
          label={t("offers.audience")}
          value={rules.audience}
          onChange={(e) => set({ audience: e.currentTarget.value as Audience })}
        >
          {AUDIENCES.map((a) => (
            <s-option key={a} value={a}>
              {t(`offers.audience.${a}`)}
            </s-option>
          ))}
        </s-select>
        <s-text-field
          label={t("offers.customerTags")}
          details={t("offers.customerTagsHelp")}
          value={tags}
          onInput={(e) => setTags(e.currentTarget.value)}
          onBlur={() => set({ customerTags: list(tags).slice(0, 10) })}
        />
        <s-text-field
          label={t("offers.countries")}
          details={t("offers.countriesHelp")}
          value={countries}
          onInput={(e) => setCountries(e.currentTarget.value)}
          onBlur={() =>
            set({
              countries: list(countries.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
            })
          }
        />
        <s-select
          label={t("offers.abGroup")}
          details={t("offers.abGroupHelp")}
          value={rules.abGroup}
          onChange={(e) => set({ abGroup: e.currentTarget.value as AbGroup })}
        >
          {AB_GROUPS.map((g) => (
            <s-option key={g || "all"} value={g}>
              {t(`offers.ab.${g || "all"}`)}
            </s-option>
          ))}
        </s-select>
        <s-number-field
          label={t("offers.priority")}
          details={t("offers.priorityHelp")}
          value={String(rules.priority)}
          min={0}
          max={100}
          onChange={(e) =>
            set({
              priority: Math.min(100, Math.max(0, Math.round(Number(e.currentTarget.value) || 0))),
            })
          }
        />
      </s-stack>
    </s-section>
  );
}

/** সেভ করার সময় শুধু এই ধরনের অফারের ফিল্ড পাঠাই */
function configFor(type: OfferType, d: Draft) {
  const common = { message: d.message, rules: d.rules };
  switch (type) {
    case "volume":
      return { ...common, products: d.products, tiers: d.tiers };
    case "bundle":
      return { ...common, products: d.products, value: d.value, title: d.title };
    case "gift":
      return {
        ...common,
        products: d.products,
        minQty: d.minQty,
        gift: d.gift,
        giftQty: d.giftQty,
        progressText: d.progressText,
      };
    case "bogo":
      return {
        ...common,
        buyProducts: d.buyProducts,
        buyQty: d.buyQty,
        getProducts: d.getProducts,
        getQty: d.getQty,
        value: d.value,
        maxUses: d.maxUses,
      };
  }
}

export default function OfferEditor() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [name, setName] = useState(data.name);
  const [active, setActive] = useState(data.active);
  const [draft, setDraft] = useState<Draft>(data.draft as Draft);
  const type = data.type;
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

  async function pickGift() {
    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: false,
      filter: { variants: true },
    });
    const product = selected?.[0];
    const variant = product?.variants?.[0];
    if (!product || !variant?.id) return;
    const variantTitle =
      variant.title && variant.title !== "Default Title" ? ` (${variant.title})` : "";
    update({
      gift: {
        id: variant.id.split("/").pop()!,
        productId: product.id.split("/").pop()!,
        handle: product.handle,
        title: `${product.title}${variantTitle}`,
      },
    });
  }

  function save(intent?: string) {
    fetcher.submit(JSON.stringify({ intent, type, name, active, config: configFor(type, draft) }), {
      method: "POST",
      encType: "application/json",
    });
  }

  return (
    <s-page heading={data.id ? name || t(`offers.type.${type}`) : t(`offers.new.${type}`)}>
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

      {type === "volume" && (
        <>
          <s-section heading={t("offers.products")}>
            <s-stack direction="block" gap="base">
              <s-paragraph>{t("offers.productsVolumeHelp")}</s-paragraph>
              <ProductList
                products={draft.products}
                onChange={(products) => update({ products })}
                emptyText={t("offers.allProducts")}
                max={100}
              />
            </s-stack>
          </s-section>
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
        </>
      )}

      {type === "bundle" && (
        <>
          <s-section heading={t("offers.products")}>
            <s-stack direction="block" gap="base">
              <s-paragraph>{t("offers.productsBundleHelp")}</s-paragraph>
              <ProductList
                products={draft.products}
                onChange={(products) => update({ products })}
                withQty
                max={5}
              />
            </s-stack>
          </s-section>
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
        </>
      )}

      {type === "gift" && (
        <>
          <s-section heading={t("offers.giftProduct")}>
            <s-stack direction="block" gap="base">
              <s-paragraph>{t("offers.giftHelp")}</s-paragraph>
              {draft.gift ? (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-text>{draft.gift.title}</s-text>
                  <s-button variant="tertiary" onClick={() => void pickGift()}>
                    {t("offers.change")}
                  </s-button>
                </s-stack>
              ) : (
                <s-button onClick={() => void pickGift()}>{t("offers.chooseGift")}</s-button>
              )}
              <s-number-field
                label={t("offers.giftQty")}
                value={String(draft.giftQty)}
                min={1}
                max={5}
                onChange={(e) => update({ giftQty: Number(e.currentTarget.value) || 1 })}
              />
            </s-stack>
          </s-section>
          <s-section heading={t("offers.unlock")}>
            <s-stack direction="block" gap="base">
              <s-paragraph>{t("offers.unlockHelp")}</s-paragraph>
              <ProductList
                products={draft.products}
                onChange={(products) => update({ products })}
                emptyText={t("offers.anyProduct")}
                max={100}
              />
              <s-number-field
                label={t("offers.minQtyUnlock")}
                value={String(draft.minQty)}
                min={1}
                max={100}
                onChange={(e) => update({ minQty: Number(e.currentTarget.value) || 1 })}
              />
              <s-text-field
                label={t("offers.progressText")}
                details={t("offers.progressTextHelp")}
                value={draft.progressText}
                maxLength={120}
                onInput={(e) => update({ progressText: e.currentTarget.value })}
              />
            </s-stack>
          </s-section>
        </>
      )}

      {type === "bogo" && (
        <>
          <s-section heading={t("offers.buy")}>
            <s-stack direction="block" gap="base">
              <s-number-field
                label={t("offers.buyQty")}
                value={String(draft.buyQty)}
                min={1}
                max={20}
                onChange={(e) => update({ buyQty: Number(e.currentTarget.value) || 1 })}
              />
              <ProductList
                products={draft.buyProducts}
                onChange={(buyProducts) => update({ buyProducts })}
                emptyText={t("offers.anyProduct")}
                max={100}
              />
            </s-stack>
          </s-section>
          <s-section heading={t("offers.get")}>
            <s-stack direction="block" gap="base">
              <s-number-field
                label={t("offers.getQty")}
                value={String(draft.getQty)}
                min={1}
                max={20}
                onChange={(e) => update({ getQty: Number(e.currentTarget.value) || 1 })}
              />
              <ProductList
                products={draft.getProducts}
                onChange={(getProducts) => update({ getProducts })}
                emptyText={t("offers.sameAsBuy")}
                max={100}
              />
              <ValueFields
                label={t("offers.discountOnGet")}
                value={draft.value}
                onChange={(value) => update({ value })}
              />
              <s-number-field
                label={t("offers.maxUses")}
                details={t("offers.maxUsesHelp")}
                value={String(draft.maxUses)}
                min={0}
                max={100}
                onChange={(e) =>
                  update({ maxUses: Math.max(0, Number(e.currentTarget.value) || 0) })
                }
              />
            </s-stack>
          </s-section>
        </>
      )}

      <RulesSection rules={draft.rules} onChange={(rules) => update({ rules })} />

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
