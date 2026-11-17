import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { emailProvider } from "../lib/email-transport.server";
import { deskErrors, errorStats, type ErrorView } from "../lib/errors.server";
import { sourceKey } from "../lib/errors";
import { isDeskShop, supportInbox } from "../lib/support.server";
import { ago, minutesSince } from "../lib/ago";
import { useT } from "../lib/i18n";

/**
 * অ্যাপের ত্রুটির খাতা (সাপোর্ট ডেস্কের অংশ): সব স্টোরের সার্ভার, ব্যাকগ্রাউন্ড কাজ, webhook আর অ্যাডমিন পাতার
 * ত্রুটি, ধরন অনুযায়ী গোনা। শুধু SUPPORT_DESK_SHOPS-এ লেখা স্টোরে খোলে।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isDeskShop(session.shop)) return { allowed: false as const };
  const view: ErrorView =
    new URL(request.url).searchParams.get("view") === "fixed" ? "fixed" : "open";
  const now = new Date();
  const [rows, stats] = await Promise.all([deskErrors(view), errorStats(now)]);
  return {
    allowed: true as const,
    view,
    alertsReady: emailProvider() !== "none" && supportInbox() !== null,
    stats,
    errors: rows.map((row) => ({
      id: row.id,
      title: `${row.name}: ${row.message}`,
      source: row.source,
      location: row.location,
      count: row.count,
      shop: row.lastShop,
      minutes: minutesSince(row.lastSeenAt, now),
    })),
  };
};

const VIEWS: ErrorView[] = ["open", "fixed"];
const shorten = (text: string, max = 140) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export default function DeskErrorsPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();

  if (!data.allowed) {
    return (
      <s-page heading={t("deskErrors.title")}>
        <s-banner tone="warning">{t("deskErrors.detail.notFound")}</s-banner>
      </s-page>
    );
  }

  const { stats } = data;
  const tabLabel = (view: ErrorView) =>
    view === "open" && stats.open > 0
      ? t("deskErrors.tab.openCount", { n: stats.open })
      : t(`deskErrors.tab.${view}`);

  return (
    <s-page heading={t("deskErrors.title")}>
      <s-link slot="breadcrumb-actions" href="/app/desk">
        {t("desk.title")}
      </s-link>
      {!data.alertsReady && <s-banner tone="info">{t("deskErrors.noAlerts")}</s-banner>}

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
        <s-section heading={t("deskErrors.open")}>
          <s-heading>{String(stats.open)}</s-heading>
        </s-section>
        <s-section heading={t("deskErrors.lastDay")}>
          <s-heading>{String(stats.lastDay)}</s-heading>
        </s-section>
      </s-grid>

      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200">
            {VIEWS.map((view) => (
              <s-button
                key={view}
                href={view === "open" ? "/app/desk/errors" : `/app/desk/errors?view=${view}`}
                variant={data.view === view ? "primary" : "secondary"}
              >
                {tabLabel(view)}
              </s-button>
            ))}
          </s-stack>
          {data.errors.length === 0 ? (
            <s-paragraph>{t(`deskErrors.empty.${data.view}`)}</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{t("deskErrors.error")}</s-table-header>
                <s-table-header>{t("deskErrors.where")}</s-table-header>
                <s-table-header format="numeric">{t("deskErrors.count")}</s-table-header>
                <s-table-header>{t("deskErrors.lastSeen")}</s-table-header>
                <s-table-header>{t("deskErrors.store")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.errors.map((error) => (
                  <s-table-row key={error.id}>
                    <s-table-cell>
                      <s-link href={`/app/desk/errors/${error.id}`}>{shorten(error.title)}</s-link>
                    </s-table-cell>
                    <s-table-cell>
                      {`${t(sourceKey(error.source))} · ${error.location}`}
                    </s-table-cell>
                    <s-table-cell>{String(error.count)}</s-table-cell>
                    <s-table-cell>{ago(t, error.minutes)}</s-table-cell>
                    <s-table-cell>{error.shop ?? t("deskErrors.unknownStore")}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          <s-text color="subdued">{t("deskErrors.privacy")}</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
