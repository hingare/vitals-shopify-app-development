import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { OFFER_TOOL_BY_TYPE } from "@app/tools";

import { authenticate } from "../shopify.server";
import { ensureShop, planOf } from "../lib/shop.server";
import { getToolStates, syncStoreConfig } from "../lib/tools.server";
import { listOffers, readOfferSettings, saveOfferSettings } from "../lib/offers.server";
import { getOfferReport } from "../lib/offer-stats.server";
import { CONFLICT_MODES, OFFER_TYPES, type ConflictMode, type OfferType } from "../lib/offers";
import { useT } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [offers, states, report] = await Promise.all([
    listOffers(shop.id),
    getToolStates(shop.id),
    getOfferReport(shop.id),
  ]);
  const on = new Set(states.filter((s) => s.enabled).map((s) => s.tool.id));
  return {
    toolsOn: Object.fromEntries(
      OFFER_TYPES.map((t) => [t, on.has(OFFER_TOOL_BY_TYPE[t])]),
    ) as Record<OfferType, boolean>,
    settings: readOfferSettings(shop.offerSettings),
    report,
    offers: offers.map((o) => ({
      id: o.id,
      type: o.type as OfferType,
      name: o.name,
      active: o.active,
      abGroup: (o.config as { rules?: { abGroup?: string } } | null)?.rules?.abGroup ?? "",
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as { conflict?: ConflictMode };
  if (!(await saveOfferSettings(shop.id, { conflict: body.conflict }))) {
    return { ok: false as const };
  }
  await syncStoreConfig(admin, { id: shop.id, plan: planOf(shop) }).catch((error: unknown) =>
    console.warn("[offers] sync failed", error),
  );
  return { ok: true as const };
};

export default function OffersPage() {
  const { offers, toolsOn, settings, report } = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const usedTypes = new Set(offers.map((o) => o.type));
  const toolsMissing = [...usedTypes].some((type) => !toolsOn[type]);
  const abRunning = offers.some((o) => o.abGroup);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) shopify.toast.show(t("offers.saved"));
  }, [fetcher.state, fetcher.data, shopify, t]);

  return (
    <s-page heading={t("nav.offers")}>
      <s-button slot="primary-action" variant="primary" href="/app/offers/new?type=volume">
        {t("offers.new.volume")}
      </s-button>
      {OFFER_TYPES.filter((type) => type !== "volume").map((type) => (
        <s-button key={type} slot="secondary-actions" href={`/app/offers/new?type=${type}`}>
          {t(`offers.new.${type}`)}
        </s-button>
      ))}

      {toolsMissing && (
        <s-banner tone="info">
          {t("offers.toolsOff")} <s-link href="/app/tools">{t("nav.tools")}</s-link>
        </s-banner>
      )}

      <s-section>
        {offers.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-heading>{t("offers.emptyTitle")}</s-heading>
            <s-paragraph>{t("offers.emptyBody")}</s-paragraph>
          </s-stack>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("offers.name")}</s-table-header>
              <s-table-header>{t("offers.type")}</s-table-header>
              <s-table-header>{t("offers.status")}</s-table-header>
              <s-table-header format="numeric">{t("offers.orders")}</s-table-header>
              <s-table-header format="numeric">{t("offers.revenue")}</s-table-header>
              <s-table-header format="numeric">{t("offers.aov")}</s-table-header>
              <s-table-header format="numeric">{t("offers.discountGiven")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {offers.map((offer) => {
                const stats = report.offers[offer.id];
                return (
                  <s-table-row key={offer.id}>
                    <s-table-cell>
                      <s-link href={`/app/offers/${offer.id}`}>{offer.name}</s-link>
                      {offer.abGroup && (
                        <>
                          {" "}
                          <s-badge tone="info">{t(`offers.ab.${offer.abGroup}`)}</s-badge>
                        </>
                      )}
                    </s-table-cell>
                    <s-table-cell>{t(`offers.type.${offer.type}`)}</s-table-cell>
                    <s-table-cell>
                      {offer.active && toolsOn[offer.type] ? (
                        <s-badge tone="success">{t("offers.live")}</s-badge>
                      ) : (
                        <s-badge>{t("offers.paused")}</s-badge>
                      )}
                    </s-table-cell>
                    <s-table-cell>{stats?.orders ?? 0}</s-table-cell>
                    <s-table-cell>{money(stats?.revenue ?? 0)}</s-table-cell>
                    <s-table-cell>{money(stats?.aov ?? 0)}</s-table-cell>
                    <s-table-cell>{money(stats?.discount ?? 0)}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
        {offers.length > 0 && (
          <s-text color="subdued">
            {t("offers.reportNote").replace("{days}", String(report.days))}
          </s-text>
        )}
      </s-section>

      {(abRunning || report.ab.length > 0) && (
        <s-section heading={t("offers.abTitle")}>
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("offers.abBody")}</s-paragraph>
            <s-table>
              <s-table-header-row>
                <s-table-header>{t("offers.abGroup")}</s-table-header>
                <s-table-header format="numeric">{t("offers.orders")}</s-table-header>
                <s-table-header format="numeric">{t("offers.revenue")}</s-table-header>
                <s-table-header format="numeric">{t("offers.aov")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {(["A", "B"] as const).map((group) => {
                  const row = report.ab.find((r) => r.group === group);
                  return (
                    <s-table-row key={group}>
                      <s-table-cell>{t(`offers.ab.${group}`)}</s-table-cell>
                      <s-table-cell>{row?.orders ?? 0}</s-table-cell>
                      <s-table-cell>{money(row?.revenue ?? 0)}</s-table-cell>
                      <s-table-cell>{money(row?.aov ?? 0)}</s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          </s-stack>
        </s-section>
      )}

      <s-section heading={t("offers.conflictTitle")}>
        <s-select
          label={t("offers.conflict")}
          details={t("offers.conflictHelp")}
          value={settings.conflict}
          onChange={(e) =>
            fetcher.submit(JSON.stringify({ conflict: e.currentTarget.value }), {
              method: "POST",
              encType: "application/json",
            })
          }
        >
          {CONFLICT_MODES.map((mode) => (
            <s-option key={mode} value={mode}>
              {t(`offers.conflict.${mode}`)}
            </s-option>
          ))}
        </s-select>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
