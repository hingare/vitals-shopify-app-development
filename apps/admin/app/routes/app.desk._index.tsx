import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { emailProvider } from "../lib/email-transport.server";
import {
  deskStats,
  deskTickets,
  isDeskShop,
  supportInbox,
  type DeskView,
} from "../lib/support.server";
import { durationLabel } from "../lib/support";
import { ago, minutesSince } from "../lib/ago";
import { useT } from "../lib/i18n";

/**
 * অ্যাপের মালিকের সাপোর্ট ডেস্ক: সব স্টোরের টিকিট আর উত্তরের সময়। শুধু SUPPORT_DESK_SHOPS-এ লেখা
 * স্টোরে খোলে; অন্য স্টোরে পাতাটা নেই বলে দেখায়।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isDeskShop(session.shop)) return { allowed: false as const };
  const param = new URL(request.url).searchParams.get("view");
  const view: DeskView = param === "answered" || param === "closed" ? param : "open";
  const now = new Date();
  const [tickets, stats] = await Promise.all([deskTickets(view), deskStats(now)]);
  return {
    allowed: true as const,
    view,
    emailReady: emailProvider() !== "none",
    inboxReady: supportInbox() !== null,
    stats: {
      waiting: stats.waiting,
      oldestMinutes: stats.oldestWaitingSince ? minutesSince(stats.oldestWaitingSince, now) : null,
      medianReplyMinutes: stats.medianReplyMinutes,
      lastWeek: stats.lastWeek,
    },
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      subject: ticket.subject,
      shop: ticket.shop,
      plan: ticket.plan,
      minutes: minutesSince(ticket.lastMessageAt, now),
    })),
  };
};

const VIEWS: DeskView[] = ["open", "answered", "closed"];

export default function DeskPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();

  if (!data.allowed) {
    return (
      <s-page heading={t("desk.title")}>
        <s-banner tone="warning">{t("desk.ticket.notFound")}</s-banner>
      </s-page>
    );
  }

  const { stats } = data;
  const tabLabel = (view: DeskView) =>
    view === "open"
      ? stats.waiting > 0
        ? t("desk.tab.openCount", { n: stats.waiting })
        : t("desk.tab.open")
      : t(`desk.tab.${view}`);

  return (
    <s-page heading={t("desk.title")}>
      <s-link slot="breadcrumb-actions" href="/app/help">
        {t("helpPage.title")}
      </s-link>
      {!data.emailReady ? (
        <s-banner tone="warning">{t("desk.noEmail")}</s-banner>
      ) : (
        !data.inboxReady && <s-banner tone="info">{t("desk.noInbox")}</s-banner>
      )}

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
        <s-section heading={t("desk.waiting")}>
          <s-heading>{String(stats.waiting)}</s-heading>
        </s-section>
        <s-section heading={t("desk.oldest")}>
          <s-heading>
            {stats.oldestMinutes === null ? t("desk.none") : durationLabel(t, stats.oldestMinutes)}
          </s-heading>
        </s-section>
        <s-section heading={t("desk.firstReply")}>
          <s-heading>
            {stats.medianReplyMinutes === null
              ? t("desk.none")
              : durationLabel(t, stats.medianReplyMinutes)}
          </s-heading>
        </s-section>
        <s-section heading={t("desk.lastWeek")}>
          <s-heading>{String(stats.lastWeek)}</s-heading>
        </s-section>
      </s-grid>

      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200">
            {VIEWS.map((view) => (
              <s-button
                key={view}
                href={view === "open" ? "/app/desk" : `/app/desk?view=${view}`}
                variant={data.view === view ? "primary" : "secondary"}
              >
                {tabLabel(view)}
              </s-button>
            ))}
          </s-stack>
          {data.tickets.length === 0 ? (
            <s-paragraph>{t(`desk.empty.${data.view}`)}</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{t("desk.subject")}</s-table-header>
                <s-table-header>{t("desk.store")}</s-table-header>
                <s-table-header>{t("desk.plan")}</s-table-header>
                <s-table-header>{t("desk.updated")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.tickets.map((ticket) => (
                  <s-table-row key={ticket.id}>
                    <s-table-cell>
                      <s-link href={`/app/desk/${ticket.id}`}>{ticket.subject}</s-link>
                    </s-table-cell>
                    <s-table-cell>{ticket.shop}</s-table-cell>
                    <s-table-cell>
                      {t(ticket.plan ? `plans.${ticket.plan}` : "plans.none")}
                    </s-table-cell>
                    <s-table-cell>{ago(t, ticket.minutes)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
