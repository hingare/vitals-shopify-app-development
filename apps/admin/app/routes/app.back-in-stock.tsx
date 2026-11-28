import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { backInStock } from "@app/tools";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { enabledSettings } from "../lib/tool-state.server";
import { listStockAlerts, STOCK_ALERTS_PAGE, variantNames } from "../lib/stock-alerts.server";
import { useT } from "../lib/i18n";

const MAX_ROWS = 500;

/** Back in Stock: কোন ক্রেতা কোন প্রোডাক্ট ফেরার খবর চেয়েছেন, আর কাকে ইমেইল গেছে */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const wanted = Number(new URL(request.url).searchParams.get("take")) || STOCK_ALERTS_PAGE;
  const take = Math.min(Math.max(wanted, STOCK_ALERTS_PAGE), MAX_ROWS);
  const [list, settings] = await Promise.all([
    listStockAlerts(shop.id, take),
    enabledSettings(shop, backInStock),
  ]);
  // Shopify থেকে নাম আনা না গেলেও তালিকা দেখায়, নামের জায়গায় প্রোডাক্টের নম্বর
  const names = await variantNames(
    admin,
    list.rows.map((row) => row.variantId),
  ).catch((error: unknown) => {
    console.warn("[back-in-stock] could not read variant names", error);
    return null;
  });
  return {
    enabled: settings !== null,
    waiting: list.waiting,
    notified: list.notified,
    lookupFailed: names === null,
    more: list.total > list.rows.length && take < MAX_ROWS ? take + STOCK_ALERTS_PAGE : 0,
    rows: list.rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      variantId: row.variantId,
      email: row.email,
      status: row.status,
      name: names?.get(row.variantId) ?? null,
      // তারিখ UTC-তে (দিন বদলের কাছাকাছি সময়ে এক দিন আগে-পরে দেখাতে পারে)
      requested: row.createdAt.slice(0, 10),
      notifiedOn: row.notifiedAt?.slice(0, 10) ?? "",
    })),
  };
};

export default function BackInStockPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();

  return (
    <s-page heading={t("backInStock.title")}>
      <s-link slot="breadcrumb-actions" href="/app/tools">
        {t("nav.tools")}
      </s-link>
      <s-button slot="secondary-actions" href="/app/tools/back-in-stock">
        {t("backInStock.settings")}
      </s-button>

      {!data.enabled && (
        <s-banner tone="warning">
          {t("backInStock.off")}{" "}
          <s-link href="/app/tools/back-in-stock">{t("backInStock.turnOn")}</s-link>
        </s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("backInStock.help")}</s-paragraph>
          <s-text color="subdued">
            {t("backInStock.summary", { waiting: data.waiting, notified: data.notified })}
          </s-text>

          {data.rows.length === 0 ? (
            <s-text color="subdued">{t("backInStock.empty")}</s-text>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>{t("backInStock.product")}</s-table-header>
                <s-table-header>{t("backInStock.email")}</s-table-header>
                <s-table-header>{t("backInStock.requested")}</s-table-header>
                <s-table-header>{t("backInStock.status")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.rows.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      {row.name ? (
                        <s-link
                          href={`shopify://admin/products/${row.productId}/variants/${row.variantId}`}
                          target="_top"
                        >
                          {row.name}
                        </s-link>
                      ) : (
                        <s-text color="subdued">
                          {data.lookupFailed
                            ? t("backInStock.unnamed", { id: row.productId })
                            : t("backInStock.deleted")}
                        </s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>{row.email}</s-table-cell>
                    <s-table-cell>{row.requested}</s-table-cell>
                    <s-table-cell>
                      {row.status === "waiting" ? (
                        <s-badge tone="info">{t("backInStock.waiting")}</s-badge>
                      ) : (
                        <s-badge tone="success">
                          {t("backInStock.notified", { date: row.notifiedOn })}
                        </s-badge>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}

          {data.more > 0 && (
            <s-button href={`/app/back-in-stock?take=${data.more}`}>
              {t("backInStock.showMore")}
            </s-button>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
