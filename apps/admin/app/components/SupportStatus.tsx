import type { TicketStatus } from "../lib/support";
import { useT } from "../lib/i18n";

/** সাপোর্ট টিকিটের অবস্থা; মার্চেন্ট এখনো না পড়া উত্তর থাকলে "নতুন উত্তর" */
export function StatusBadge({
  status,
  unread = false,
}: {
  status: TicketStatus;
  unread?: boolean;
}) {
  const t = useT();
  if (unread) return <s-badge tone="warning">{t("support.newReply")}</s-badge>;
  if (status === "answered") {
    return <s-badge tone="success">{t("support.status.answered")}</s-badge>;
  }
  if (status === "closed") return <s-badge>{t("support.status.closed")}</s-badge>;
  return <s-badge tone="info">{t("support.status.open")}</s-badge>;
}
