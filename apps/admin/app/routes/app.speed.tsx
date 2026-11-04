import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { getSpeedSummary } from "../lib/speed.server";
import { enqueueSpeedCheck, latestSpeedJob } from "../lib/jobs.server";
import { useT } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [summary, job] = await Promise.all([getSpeedSummary(shop.id), latestSpeedJob(shop.id)]);
  return {
    job: job ? { status: job.status, error: job.error } : null,
    baseline: summary.baseline,
    latest: summary.latest,
    history: summary.history.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  try {
    await enqueueSpeedCheck(admin, shop.id);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
};

export default function SpeedPage() {
  const { baseline, latest, history, job } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const t = useT();
  const measuring = job?.status === "pending" || job?.status === "running";
  const running = fetcher.state !== "idle" || measuring;

  // মাপ ব্যাকগ্রাউন্ডে চলে; শেষ না হওয়া পর্যন্ত কয়েক সেকেন্ড পরপর পেজ রিফ্রেশ
  useEffect(() => {
    if (!measuring) return;
    const id = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 4000);
    return () => clearInterval(id);
  }, [measuring, revalidator]);

  return (
    <s-page heading={t("speed.title")}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => fetcher.submit({}, { method: "POST" })}
        {...(running ? { loading: true } : {})}
      >
        {t("speed.run")}
      </s-button>

      {measuring && <s-banner tone="info">{t("speed.measuring")}</s-banner>}
      {job?.status === "failed" && !measuring && (
        <s-banner tone="critical">{t("speed.failed", { error: job.error ?? "" })}</s-banner>
      )}
      {fetcher.data && !fetcher.data.ok && (
        <s-banner tone="critical">{t("speed.failed", { error: fetcher.data.error })}</s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("speed.description")}</s-paragraph>
          <s-text color="subdued">{t("speed.passwordNote")}</s-text>
        </s-stack>
      </s-section>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
        <s-section heading={t("speed.baseline")}>
          <s-heading>{baseline ? baseline.score : "–"}</s-heading>
        </s-section>
        <s-section heading={t("speed.latest")}>
          <s-heading>{latest ? latest.score : "–"}</s-heading>
        </s-section>
      </s-grid>

      <s-section heading={t("speed.history")}>
        {history.length === 0 ? (
          <s-text color="subdued">{t("speed.empty")}</s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Date</s-table-header>
              <s-table-header>{t("speed.score")}</s-table-header>
              <s-table-header>LCP</s-table-header>
              <s-table-header>CLS</s-table-header>
              <s-table-header>TBT</s-table-header>
              <s-table-header>{t("dashboard.enabledTools")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {history.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>{new Date(row.createdAt).toLocaleString()}</s-table-cell>
                  <s-table-cell>
                    {row.score}
                    {row.kind === "baseline" ? ` (${t("speed.baseline")})` : ""}
                  </s-table-cell>
                  <s-table-cell>
                    {row.lcpMs !== null ? `${(row.lcpMs / 1000).toFixed(1)}s` : "–"}
                  </s-table-cell>
                  <s-table-cell>{row.cls ?? "–"}</s-table-cell>
                  <s-table-cell>{row.tbtMs !== null ? `${row.tbtMs}ms` : "–"}</s-table-cell>
                  <s-table-cell>{row.enabledTools}</s-table-cell>
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
