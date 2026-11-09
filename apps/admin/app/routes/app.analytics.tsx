import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { MessageKey } from "@app/i18n";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { getToolStats } from "../lib/analytics.server";
import { getStoreReport } from "../lib/store-analytics.server";
import { rate } from "../lib/rate";
import { useT } from "../lib/i18n";

const PERIODS = [7, 30, 90] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const requested = Number(new URL(request.url).searchParams.get("days"));
  const days = (PERIODS as readonly number[]).includes(requested) ? requested : 30;

  const [report, tools, currency] = await Promise.all([
    getStoreReport(shop.id, days),
    getToolStats(shop.id, days),
    admin
      .graphql(
        `#graphql
        query AnalyticsCurrency { shop { currencyCode } }`,
      )
      .then((r) => r.json() as Promise<{ data?: { shop?: { currencyCode?: string } } }>)
      .then((j) => j.data?.shop?.currencyCode ?? "USD")
      .catch(() => "USD"),
  ]);
  return { days, report, tools, currency, pixelConnected: Boolean(shop.pixelId) };
};

function Bar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div
      style={{
        background: "var(--s-color-bg-fill-secondary, #f1f1f1)",
        height: 8,
        borderRadius: 4,
      }}
    >
      <div
        style={{
          width: `${width}%`,
          height: 8,
          borderRadius: 4,
          background: "var(--s-color-bg-fill-brand, #303030)",
        }}
      />
    </div>
  );
}

export default function AnalyticsPage() {
  const { days, report, tools, currency, pixelConnected } = useLoaderData<typeof loader>();
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { totals } = report;
  const money = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  const num = (n: number) => new Intl.NumberFormat().format(n);

  const funnel = [
    { key: "store.visitors", value: totals.visitors },
    { key: "store.productViews", value: totals.productViews },
    { key: "store.addToCarts", value: totals.addToCarts },
    { key: "store.checkouts", value: totals.checkouts },
    { key: "store.orders", value: totals.orders },
  ] as const;
  const maxDaily = Math.max(0, ...report.daily.map((d) => d.visitors));
  const empty = totals.visitors === 0 && totals.pageViews === 0;

  return (
    <s-page heading={t("nav.analytics")}>
      <s-select
        slot="primary-action"
        label={t("store.period")}
        labelAccessibilityVisibility="exclusive"
        value={String(days)}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          next.set("days", e.currentTarget.value);
          navigate(`?${next}`);
        }}
      >
        {PERIODS.map((d) => (
          <s-option key={d} value={String(d)}>
            {t("store.lastDays", { days: d })}
          </s-option>
        ))}
      </s-select>

      {!pixelConnected && <s-banner tone="warning">{t("store.pixelMissing")}</s-banner>}
      {empty && pixelConnected && <s-banner tone="info">{t("store.empty")}</s-banner>}

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
        <s-section heading={t("store.visitors")}>
          <s-heading>{num(totals.visitors)}</s-heading>
        </s-section>
        <s-section heading={t("store.orders")}>
          <s-heading>{num(totals.orders)}</s-heading>
        </s-section>
        <s-section heading={t("store.revenue")}>
          <s-heading>{money(totals.revenue)}</s-heading>
        </s-section>
        <s-section heading={t("store.conversion")}>
          <s-heading>{rate(totals.orders, totals.visitors)}%</s-heading>
        </s-section>
        <s-section heading={t("store.cartRate")}>
          <s-heading>{rate(totals.addToCarts, totals.visitors)}%</s-heading>
        </s-section>
      </s-grid>

      <s-section heading={t("store.funnel")}>
        <s-table>
          <s-table-header-row>
            <s-table-header>{t("store.step")}</s-table-header>
            <s-table-header format="numeric">{t("store.count")}</s-table-header>
            <s-table-header format="numeric">{t("store.ofVisitors")}</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {funnel.map((step) => (
              <s-table-row key={step.key}>
                <s-table-cell>{t(step.key)}</s-table-cell>
                <s-table-cell>{num(step.value)}</s-table-cell>
                <s-table-cell>{rate(step.value, totals.visitors)}%</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading={t("store.daily")}>
        {report.daily.length === 0 ? (
          <s-text color="subdued">–</s-text>
        ) : (
          <s-stack direction="block" gap="small-200">
            {report.daily.map((d) => (
              <s-grid
                key={d.date}
                gridTemplateColumns="90px 1fr 60px"
                gap="small"
                alignItems="center"
              >
                <s-text color="subdued">{d.date.slice(5)}</s-text>
                <Bar value={d.visitors} max={maxDaily} />
                <s-text>{num(d.visitors)}</s-text>
              </s-grid>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
        <s-section heading={t("store.sources")}>
          <ShareList
            rows={report.sources.map((s) => ({
              label: t(`source.${s.name}` as MessageKey),
              value: s.visitors,
            }))}
            total={totals.visitors}
          />
        </s-section>
        <s-section heading={t("store.devices")}>
          <ShareList
            rows={report.devices.map((s) => ({
              label: t(`device.${s.name}` as MessageKey),
              value: s.visitors,
            }))}
            total={totals.visitors}
          />
        </s-section>
      </s-grid>

      <s-section heading={t("store.topPages")}>
        {report.pages.length === 0 ? (
          <s-text color="subdued">–</s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("store.page")}</s-table-header>
              <s-table-header format="numeric">{t("store.pageViews")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {report.pages.map((p) => (
                <s-table-row key={p.path}>
                  <s-table-cell>{p.path}</s-table-cell>
                  <s-table-cell>{num(p.views)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={t("store.tools")}>
        {tools.length === 0 ? (
          <s-text color="subdued">{t("analytics.empty")}</s-text>
        ) : (
          <s-stack direction="block" gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header>{t("analytics.tool")}</s-table-header>
                <s-table-header format="numeric">{t("analytics.views")}</s-table-header>
                <s-table-header format="numeric">{t("analytics.clicks")}</s-table-header>
                <s-table-header format="numeric">{t("analytics.addToCarts")}</s-table-header>
                <s-table-header format="numeric">{t("analytics.orders")}</s-table-header>
                <s-table-header format="numeric">{t("analytics.revenue")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {tools.map((row) => (
                  <s-table-row key={row.toolId}>
                    <s-table-cell>{t(`tool.${row.toolId}.name` as MessageKey)}</s-table-cell>
                    <s-table-cell>{num(row.views)}</s-table-cell>
                    <s-table-cell>{num(row.clicks)}</s-table-cell>
                    <s-table-cell>{num(row.addToCarts)}</s-table-cell>
                    <s-table-cell>{num(row.orders)}</s-table-cell>
                    <s-table-cell>{money(row.revenue)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-text color="subdued">{t("analytics.note")}</s-text>
          </s-stack>
        )}
      </s-section>

      <s-section>
        <s-text color="subdued">{t("store.privacy")}</s-text>
      </s-section>
    </s-page>
  );
}

function ShareList({
  rows,
  total,
}: {
  rows: Array<{ label: string; value: number }>;
  total: number;
}) {
  if (rows.length === 0) return <s-text color="subdued">–</s-text>;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <s-stack direction="block" gap="small-200">
      {rows.map((r) => (
        <s-grid key={r.label} gridTemplateColumns="110px 1fr 56px" gap="small" alignItems="center">
          <s-text>{r.label}</s-text>
          <Bar value={r.value} max={max} />
          <s-text color="subdued">{rate(r.value, total)}%</s-text>
        </s-grid>
      ))}
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
