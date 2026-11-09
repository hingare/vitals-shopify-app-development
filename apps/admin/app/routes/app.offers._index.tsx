import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { OFFER_TOOL_BY_TYPE } from "@app/tools";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { getToolStates } from "../lib/tools.server";
import { listOffers } from "../lib/offers.server";
import { useT } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [offers, states] = await Promise.all([listOffers(shop.id), getToolStates(shop.id)]);
  const on = new Set(states.filter((s) => s.enabled).map((s) => s.tool.id));
  return {
    toolsOn: {
      volume: on.has(OFFER_TOOL_BY_TYPE.volume),
      bundle: on.has(OFFER_TOOL_BY_TYPE.bundle),
    },
    offers: offers.map((o) => ({
      id: o.id,
      type: o.type as "volume" | "bundle",
      name: o.name,
      active: o.active,
      updatedAt: o.updatedAt.toISOString().slice(0, 10),
    })),
  };
};

export default function OffersPage() {
  const { offers, toolsOn } = useLoaderData<typeof loader>();
  const t = useT();

  return (
    <s-page heading={t("nav.offers")}>
      <s-button slot="primary-action" variant="primary" href="/app/offers/new?type=volume">
        {t("offers.newVolume")}
      </s-button>
      <s-button slot="secondary-actions" href="/app/offers/new?type=bundle">
        {t("offers.newBundle")}
      </s-button>

      {(!toolsOn.volume || !toolsOn.bundle) && (
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
              <s-table-header>{t("offers.updated")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {offers.map((offer) => (
                <s-table-row key={offer.id}>
                  <s-table-cell>
                    <s-link href={`/app/offers/${offer.id}`}>{offer.name}</s-link>
                  </s-table-cell>
                  <s-table-cell>{t(`offers.type.${offer.type}`)}</s-table-cell>
                  <s-table-cell>
                    {offer.active && toolsOn[offer.type] ? (
                      <s-badge tone="success">{t("offers.live")}</s-badge>
                    ) : (
                      <s-badge>{t("offers.paused")}</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>{offer.updatedAt}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
