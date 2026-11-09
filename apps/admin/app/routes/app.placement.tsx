import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop, planOf } from "../lib/shop.server";
import { syncStoreConfig } from "../lib/tools.server";
import { type Placement, placementSchema, readPlacement } from "../lib/placement";
import { useT } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const handle = session.shop.replace(".myshopify.com", "");
  const editor = `https://admin.shopify.com/store/${handle}/themes/current/editor`;
  return {
    placement: readPlacement(shop.placement),
    productEditorUrl: `${editor}?template=product`,
    cartEditorUrl: `${editor}?template=cart`,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const parsed = placementSchema.safeParse(await request.json());
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid selector" };
  }
  await db.shop.update({ where: { id: shop.id }, data: { placement: parsed.data } });
  await syncStoreConfig(admin, { id: shop.id, plan: planOf(shop) });
  return { ok: true as const };
};

export default function PlacementPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [value, setValue] = useState<Placement>(data.placement);
  const set = (patch: Partial<Placement>) => setValue((v) => ({ ...v, ...patch }));

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show(t("tools.saved"));
    else shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.state, fetcher.data, shopify, t]);

  const whereSelect = (
    label: string,
    current: string,
    onChange: (v: "after" | "before") => void,
  ) => (
    <s-select
      label={label}
      value={current}
      onChange={(e) => onChange(e.currentTarget.value === "before" ? "before" : "after")}
    >
      <s-option value="after">{t("placement.after")}</s-option>
      <s-option value="before">{t("placement.before")}</s-option>
    </s-select>
  );

  return (
    <s-page heading={t("placement.title")}>
      <s-link slot="breadcrumb-actions" href="/app/tools">
        {t("nav.tools")}
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        {...(fetcher.state !== "idle" ? { loading: true } : {})}
        onClick={() =>
          fetcher.submit(JSON.stringify(value), { method: "POST", encType: "application/json" })
        }
      >
        {t("tools.save")}
      </s-button>

      <s-section heading={t("placement.blocksTitle")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("placement.blocksBody")}</s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button href={data.productEditorUrl} target="_blank">
              {t("placement.openProduct")}
            </s-button>
            <s-button href={data.cartEditorUrl} target="_blank">
              {t("placement.openCart")}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading={t("placement.advancedTitle")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("placement.advancedBody")}</s-paragraph>
          <s-text-field
            label={t("placement.productAnchor")}
            details={t("placement.selectorHelp")}
            placeholder=".product-form"
            maxLength={200}
            value={value.productAnchor}
            onInput={(e) => set({ productAnchor: e.currentTarget.value })}
          />
          {whereSelect(t("placement.where"), value.productWhere, (v) => set({ productWhere: v }))}
          <s-text-field
            label={t("placement.cartAnchor")}
            details={t("placement.selectorHelp")}
            placeholder=".cart__ctas"
            maxLength={200}
            value={value.cartAnchor}
            onInput={(e) => set({ cartAnchor: e.currentTarget.value })}
          />
          {whereSelect(t("placement.where"), value.cartWhere, (v) => set({ cartWhere: v }))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
