import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { customerData, hasCustomerData } from "../lib/privacy.server";
import { enqueueJob, latestJob } from "../lib/queue.server";
import {
  findCustomerId,
  listSubscribers,
  subscriberCounts,
  unsubscribe,
} from "../lib/subscribers.server";
import { cleanEmail } from "../lib/tool-state.server";
import { useT } from "../lib/i18n";

const STATUSES = ["subscribed", "unsubscribed", "bounced", "complained"] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "";
  const search = (url.searchParams.get("q") ?? "").slice(0, 100);
  const [list, counts, job] = await Promise.all([
    listSubscribers(shop.id, {
      status: (STATUSES as readonly string[]).includes(status) ? status : undefined,
      search: search || undefined,
      page: Number(url.searchParams.get("page")) || 1,
    }),
    subscriberCounts(shop.id),
    latestJob(shop.id, "subscribers-import"),
  ]);
  const progress = (job?.progress ?? {}) as { added?: number; seen?: number };
  // শেষ হওয়া আমদানির খবর কিছুক্ষণই দেখাই, পুরোনো খবর পেজে পড়ে থাকে না
  const recent = Boolean(job?.finishedAt && Date.now() - job.finishedAt.getTime() < 15 * 60_000);
  return {
    status,
    search,
    counts,
    page: list.page,
    pages: list.pages,
    total: list.total,
    rows: list.rows.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      status: row.status,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
    })),
    importJob: job
      ? {
          status: job.status,
          error: job.error,
          recent,
          added: progress.added ?? 0,
          seen: progress.seen ?? 0,
        }
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as { intent?: string; email?: string };
  if (body.intent === "export") {
    // ক্রেতা নিজের তথ্য চাইলে (GDPR): এই ইমেইলের জন্য অ্যাপে যা যা রাখা আছে
    const email = cleanEmail(body.email);
    // লগইন করা ক্রেতার wishlist ইমেইলে নয়, Shopify customer id-তে রাখা, তাই id-টা Shopify থেকে জানা হয়।
    // Shopify উত্তর না দিলে আমাদের তালিকায় থাকা id-ই ভরসা, আর মার্চেন্টকে বলা হয় wishlist বাদ পড়ে থাকতে পারে।
    let customerId: string | null = null;
    let partial = false;
    if (email) {
      try {
        customerId = await findCustomerId(admin, email);
      } catch (error) {
        partial = true;
        console.warn("[privacy] customer lookup failed", error);
      }
    }
    const data = await customerData(shop.id, { email, customerId });
    return { ok: true as const, found: hasCustomerData(data), partial, data };
  }
  if (body.intent === "import") {
    await enqueueJob(shop.id, "subscribers-import", {}, { unique: true });
  } else if (body.intent === "unsubscribe") {
    await unsubscribe(shop.id, body.email);
  }
  return { ok: true as const };
};

/** ব্রাউজারে ফাইল হিসেবে নামানো (সার্ভারে আলাদা ডাউনলোড ঠিকানা লাগে না) */
function downloadJson(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export default function SubscribersPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const fetcher = useFetcher<typeof action>();
  // তথ্য খোঁজার জন্য আলাদা fetcher, যাতে আমদানি বা আনসাবস্ক্রাইবের অবস্থার সাথে না মেশে
  const lookup = useFetcher<typeof action>();
  const [lookupEmail, setLookupEmail] = useState("");
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const importing = data.importJob?.status === "pending" || data.importJob?.status === "running";

  useEffect(() => {
    if (!importing) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 3000);
    return () => clearInterval(timer);
  }, [importing, revalidator]);

  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in patch)) next.delete("page");
    navigate(`?${next.toString()}`);
  };
  const send = (payload: Record<string, string>) =>
    fetcher.submit(JSON.stringify(payload), { method: "POST", encType: "application/json" });

  const job = data.importJob;
  const found = lookup.data && "data" in lookup.data ? lookup.data : null;
  const foundText = found?.found ? JSON.stringify(found.data, null, 2) : "";
  return (
    <s-page heading={t("subscribers.title")}>
      <s-link slot="breadcrumb-actions" href="/app/marketing">
        {t("marketing.back")}
      </s-link>
      <s-button
        slot="primary-action"
        onClick={() => send({ intent: "import" })}
        {...(importing || fetcher.state !== "idle" ? { loading: true } : {})}
      >
        {t("subscribers.import")}
      </s-button>

      {job && importing && (
        <s-banner tone="info">
          {t("subscribers.importing", { seen: job.seen, added: job.added })}
        </s-banner>
      )}
      {job?.status === "done" && job.recent && (
        <s-banner tone="success">
          {t("subscribers.importDone", { seen: job.seen, added: job.added })}
        </s-banner>
      )}
      {job?.status === "failed" && job.recent && (
        <s-banner tone="critical">
          {t("subscribers.importFailed", { error: job.error ?? "" })}
        </s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("subscribers.help")}</s-paragraph>
          <s-text color="subdued">{t("subscribers.importHelp")}</s-text>
          <s-stack direction="inline" gap="small" alignItems="end">
            <s-select
              label={t("subscribers.status")}
              value={data.status}
              onChange={(e) => go({ status: e.currentTarget.value })}
            >
              <s-option value="">{t("subscribers.all")}</s-option>
              {STATUSES.map((status) => (
                <s-option key={status} value={status}>
                  {t(`subscribers.status.${status}`)} ({data.counts[status].toLocaleString()})
                </s-option>
              ))}
            </s-select>
            <s-search-field
              label={t("subscribers.search")}
              value={data.search}
              onChange={(e) => go({ q: e.currentTarget.value.trim() })}
            />
          </s-stack>

          {data.rows.length === 0 ? (
            <s-text color="subdued">{t("subscribers.empty")}</s-text>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>{t("subscribers.email")}</s-table-header>
                <s-table-header>{t("subscribers.name")}</s-table-header>
                <s-table-header>{t("subscribers.status")}</s-table-header>
                <s-table-header>{t("subscribers.source")}</s-table-header>
                <s-table-header>{t("subscribers.added")}</s-table-header>
                <s-table-header />
              </s-table-header-row>
              <s-table-body>
                {data.rows.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>{row.email}</s-table-cell>
                    <s-table-cell>{row.firstName ?? "–"}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={row.status === "subscribed" ? "success" : "neutral"}>
                        {t(`subscribers.status.${row.status}`)}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>{t(`subscribers.source.${row.source}`)}</s-table-cell>
                    <s-table-cell>{new Date(row.createdAt).toLocaleDateString()}</s-table-cell>
                    <s-table-cell>
                      {row.status === "subscribed" && (
                        <s-button
                          variant="tertiary"
                          onClick={() => {
                            const question = t("subscribers.confirmUnsubscribe", {
                              email: row.email,
                            });
                            if (window.confirm(question)) {
                              send({ intent: "unsubscribe", email: row.email });
                            }
                          }}
                        >
                          {t("subscribers.unsubscribe")}
                        </s-button>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}

          {data.pages > 1 && (
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-button
                onClick={() => go({ page: String(data.page - 1) })}
                {...(data.page <= 1 ? { disabled: true } : {})}
              >
                {t("reviews.prev")}
              </s-button>
              <s-text>
                {data.page} / {data.pages}
              </s-text>
              <s-button
                onClick={() => go({ page: String(data.page + 1) })}
                {...(data.page >= data.pages ? { disabled: true } : {})}
              >
                {t("reviews.next")}
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section heading={t("subscribers.data.title")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("subscribers.data.help")}</s-paragraph>
          <s-stack direction="inline" gap="small" alignItems="end">
            <s-email-field
              label={t("subscribers.data.email")}
              value={lookupEmail}
              onChange={(e) => setLookupEmail(e.currentTarget.value.trim())}
            />
            <s-button
              onClick={() =>
                lookup.submit(JSON.stringify({ intent: "export", email: lookupEmail }), {
                  method: "POST",
                  encType: "application/json",
                })
              }
              {...(lookup.state !== "idle" ? { loading: true } : {})}
              {...(lookupEmail === "" ? { disabled: true } : {})}
            >
              {t("subscribers.data.find")}
            </s-button>
          </s-stack>
          {found?.partial && <s-banner tone="warning">{t("subscribers.data.partial")}</s-banner>}
          {found && !found.found && <s-text color="subdued">{t("subscribers.data.none")}</s-text>}
          {found?.found && (
            <>
              <s-text-area
                label={t("subscribers.data.result")}
                details={t("subscribers.data.resultHelp")}
                rows={12}
                readOnly
                value={foundText}
              />
              <s-button onClick={() => downloadJson("customer-data.json", foundText)}>
                {t("subscribers.data.download")}
              </s-button>
            </>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
