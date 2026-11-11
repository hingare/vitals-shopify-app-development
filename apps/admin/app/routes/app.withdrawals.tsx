import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { euWithdrawal } from "@app/tools";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { readEmailSettings } from "../lib/email-template";
import { emailProvider } from "../lib/email-transport.server";
import { enabledSettings } from "../lib/tool-state.server";
import {
  listWithdrawals,
  setWithdrawalStatus,
  submittedText,
  WITHDRAWALS_PAGE,
} from "../lib/withdrawals.server";
import { useT } from "../lib/i18n";

const MAX_ROWS = 500;

/** EU Withdrawal Button: ক্রেতাদের জমা দেওয়া প্রত্যাহারের বিবৃতির তালিকা */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const wanted = Number(new URL(request.url).searchParams.get("take")) || WITHDRAWALS_PAGE;
  const take = Math.min(Math.max(wanted, WITHDRAWALS_PAGE), MAX_ROWS);
  const [list, settings] = await Promise.all([
    listWithdrawals(shop.id, take),
    enabledSettings(shop, euWithdrawal),
  ]);
  return {
    enabled: settings !== null,
    emailReady: emailProvider() !== "none",
    // reply-to ঠিকানা থাকলে প্রতিটা নতুন বিবৃতির খবর মার্চেন্টের ইমেইলেও যায়
    noticeReady: readEmailSettings(shop.emailSettings).replyTo !== "",
    formUrl: `https://${shop.domain}/apps/app-tools/withdraw`,
    total: list.total,
    open: list.open,
    more: list.total > list.rows.length && take < MAX_ROWS ? take + WITHDRAWALS_PAGE : 0,
    rows: list.rows.map((row) => ({
      ...row,
      // ক্রেতার ইমেইলে যে তারিখ ও সময় গেছে হুবহু সেটাই (UTC), যাতে দুই পক্ষ একই সময় দেখে
      received: submittedText(new Date(row.createdAt), "en"),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as { intent?: string; id?: string };
  if (typeof body.id !== "string") return { ok: false as const };
  if (body.intent === "handled" || body.intent === "new") {
    return { ok: await setWithdrawalStatus(shop.id, body.id, body.intent) };
  }
  return { ok: false as const };
};

export default function WithdrawalsPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const fetcher = useFetcher<typeof action>();
  const busyId =
    fetcher.state !== "idle" ? ((fetcher.json as { id?: string } | undefined)?.id ?? null) : null;
  const send = (payload: Record<string, string>) =>
    fetcher.submit(JSON.stringify(payload), { method: "POST", encType: "application/json" });
  const mailTone = { sent: "success", queued: "info", failed: "critical" } as const;

  return (
    <s-page heading={t("withdrawals.title")}>
      <s-link slot="breadcrumb-actions" href="/app/tools">
        {t("nav.tools")}
      </s-link>
      <s-button slot="secondary-actions" href="/app/tools/eu-withdrawal">
        {t("withdrawals.settings")}
      </s-button>

      {!data.enabled && (
        <s-banner tone="warning">
          {t("withdrawals.off")}{" "}
          <s-link href="/app/tools/eu-withdrawal">{t("withdrawals.turnOn")}</s-link>
        </s-banner>
      )}
      {data.enabled && !data.emailReady && (
        <s-banner tone="critical">{t("withdrawals.noEmail")}</s-banner>
      )}
      {data.enabled && data.emailReady && !data.noticeReady && (
        <s-banner tone="info">
          {t("withdrawals.noNotice")}{" "}
          <s-link href="/app/marketing">{t("withdrawals.addReplyTo")}</s-link>
        </s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("withdrawals.help")}</s-paragraph>
          <s-text color="subdued">{data.formUrl}</s-text>
          {data.open > 0 && (
            <s-badge tone="warning">{t("withdrawals.openCount", { count: data.open })}</s-badge>
          )}

          {data.rows.length === 0 ? (
            <s-text color="subdued">{t("withdrawals.empty")}</s-text>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>{t("subscribers.name")}</s-table-header>
                <s-table-header>{t("withdrawals.order")}</s-table-header>
                <s-table-header>{t("withdrawals.received")}</s-table-header>
                <s-table-header>{t("withdrawals.details")}</s-table-header>
                <s-table-header>{t("withdrawals.confirmation")}</s-table-header>
                <s-table-header />
              </s-table-header-row>
              <s-table-body>
                {data.rows.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-200">
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <s-text type="strong">{row.name}</s-text>
                          <s-badge tone={row.status === "new" ? "warning" : "neutral"}>
                            {t(`withdrawals.${row.status}`)}
                          </s-badge>
                        </s-stack>
                        <s-text color="subdued">{row.email}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{row.orderNumber}</s-table-cell>
                    <s-table-cell>{row.received}</s-table-cell>
                    <s-table-cell>
                      {row.details ? (
                        <span style={{ whiteSpace: "pre-wrap" }}>{row.details}</span>
                      ) : (
                        <s-text color="subdued">{t("withdrawals.noDetails")}</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {row.ack ? (
                        <s-badge tone={mailTone[row.ack]}>
                          {t(`withdrawals.mail.${row.ack}`)}
                        </s-badge>
                      ) : (
                        "–"
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        onClick={() =>
                          send({ intent: row.status === "new" ? "handled" : "new", id: row.id })
                        }
                        {...(busyId === row.id ? { loading: true } : {})}
                      >
                        {t(row.status === "new" ? "withdrawals.markHandled" : "withdrawals.reopen")}
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}

          {data.more > 0 && (
            <s-button href={`/app/withdrawals?take=${data.more}`}>
              {t("withdrawals.showMore")}
            </s-button>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
