import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { TFunction } from "@app/i18n";
import { seoMetaTemplates } from "@app/tools";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { metaOverview, startMetaJob } from "../lib/seo-meta.server";
import { enabledSettings } from "../lib/tool-state.server";
import type {
  BotPurpose,
  Check,
  CheckState,
  CrawlerAccess,
  Fix,
  VisibilityReport,
} from "../lib/ai-visibility.server";
import { useT } from "../lib/i18n";
import type { loader as reportLoader } from "./app.seo.report";

/**
 * AI ভিজিবিলিটি: স্কোর আর প্রতিটা ঘর ঠিক করার পথ, কোন AI ক্রলার স্টোরে ঢুকতে পারে, Shopify-র
 * llms.txt / agents.md, আর ফাঁকা SEO টাইটেল ও বর্ণনা ভরার কাজ (SEO Meta Templates)।
 * স্কোরের যাচাই আলাদা রাস্তা থেকে আসে (app.seo.report), তাই পেজ তাড়াতাড়ি খোলে।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return metaOverview(admin, shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as { intent?: string };
  if (body.intent === "fill") {
    if (!(await enabledSettings(shop, seoMetaTemplates))) {
      return { ok: false as const, error: "off" };
    }
    const started = await startMetaJob(shop.id, "meta-fill");
    return started ? { ok: true as const } : { ok: false as const, error: "busy" };
  }
  if (body.intent === "undo") {
    // টুল বন্ধ থাকলেও আগের অবস্থায় ফেরানো যায়
    const started = await startMetaJob(shop.id, "meta-undo");
    return started ? { ok: true as const } : { ok: false as const, error: "busy" };
  }
  return { ok: false as const, error: "unknown" };
};

type Tone = "success" | "warning" | "critical" | "neutral" | "info";

const STATE_TONE: Record<CheckState, Tone> = {
  pass: "success",
  partial: "warning",
  fail: "critical",
  unknown: "neutral",
  locked: "info",
};

const scoreTone = (score: number): Tone =>
  score >= 80 ? "success" : score >= 50 ? "warning" : "critical";

const PURPOSES: BotPurpose[] = ["search", "user", "training"];

function FixButton({ fix, t }: { fix: Fix; t: TFunction }) {
  const label = t(`visibility.fix.${fix.action}`);
  if (fix.href.startsWith("#")) {
    const id = fix.href.slice(1);
    return (
      <s-button onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })}>
        {label}
      </s-button>
    );
  }
  // Shopify অ্যাডমিনের পাতা পুরো জানালায়, থিম এডিটর নতুন ট্যাবে, অ্যাপের পাতা অ্যাপের ভেতরেই
  const target = fix.href.startsWith("shopify://")
    ? "_top"
    : fix.href.startsWith("https://")
      ? "_blank"
      : undefined;
  return (
    <s-button href={fix.href} {...(target ? { target } : {})}>
      {label}
    </s-button>
  );
}

function CheckRow({ check, t }: { check: Check; t: TFunction }) {
  return (
    <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
      <s-stack direction="block" gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text type="strong">{t(`visibility.check.${check.id}`)}</s-text>
          <s-badge tone={STATE_TONE[check.state]}>{t(`visibility.state.${check.state}`)}</s-badge>
        </s-stack>
        <s-text color="subdued">
          {t(`visibility.check.${check.id}.${check.reason}`, check.params)}
        </s-text>
      </s-stack>
      {check.fix && <FixButton fix={check.fix} t={t} />}
    </s-stack>
  );
}

function ScoreSection({
  report,
  failed,
  checking,
  onCheck,
  t,
}: {
  report: VisibilityReport | null;
  failed: boolean;
  checking: boolean;
  onCheck: () => void;
  t: TFunction;
}) {
  const again = (
    <s-stack direction="inline">
      <s-button onClick={onCheck} {...(checking ? { loading: true } : {})}>
        {t("visibility.checkAgain")}
      </s-button>
    </s-stack>
  );
  if (!report) {
    return (
      <s-section heading={t("visibility.scoreHeading")}>
        {failed ? (
          <s-stack direction="block" gap="base">
            <s-banner tone="critical">{t("visibility.failed")}</s-banner>
            {again}
          </s-stack>
        ) : (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-spinner accessibilityLabel={t("visibility.checking")} />
            <s-text color="subdued">{t("visibility.checking")}</s-text>
          </s-stack>
        )}
      </s-section>
    );
  }
  // যা করার বাকি সেগুলো আগে
  const order: CheckState[] = ["fail", "partial", "locked", "unknown", "pass"];
  const checks = [...report.checks].sort(
    (a, b) => order.indexOf(a.state) - order.indexOf(b.state) || b.weight - a.weight,
  );
  return (
    <s-section heading={t("visibility.scoreHeading")}>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-heading>
            {report.score === null
              ? t("visibility.scoreNone")
              : t("visibility.score", { score: report.score })}
          </s-heading>
          {report.score !== null && (
            <s-badge tone={scoreTone(report.score)}>
              {t(`visibility.grade.${scoreTone(report.score)}`)}
            </s-badge>
          )}
        </s-stack>
        <s-paragraph>{t("visibility.intro")}</s-paragraph>
        {report.passwordProtected && <s-banner tone="info">{t("visibility.password")}</s-banner>}
        {checks.map((check, index) => (
          <s-stack key={check.id} direction="block" gap="base">
            {index > 0 && <s-divider />}
            <CheckRow check={check} t={t} />
          </s-stack>
        ))}
        <s-text color="subdued">{t("visibility.scoreHelp")}</s-text>
        {again}
      </s-stack>
    </s-section>
  );
}

function CrawlerSection({ crawlers, t }: { crawlers: CrawlerAccess[] | null; t: TFunction }) {
  return (
    <s-section heading={t("visibility.crawlersHeading")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("visibility.crawlersHelp")}</s-paragraph>
        {crawlers === null ? (
          <s-text color="subdued">{t("visibility.crawlersUnknown")}</s-text>
        ) : (
          PURPOSES.map((purpose) => (
            <s-stack key={purpose} direction="block" gap="small-200">
              <s-text type="strong">{t(`visibility.purpose.${purpose}`)}</s-text>
              {purpose === "training" && (
                <s-text color="subdued">{t("visibility.purpose.trainingHelp")}</s-text>
              )}
              <s-table>
                <s-table-header-row>
                  <s-table-header>{t("visibility.column.assistant")}</s-table-header>
                  <s-table-header>{t("visibility.column.crawler")}</s-table-header>
                  <s-table-header>{t("visibility.column.access")}</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {crawlers
                    .filter((bot) => bot.purpose === purpose)
                    .map((bot) => (
                      <s-table-row key={bot.token}>
                        <s-table-cell>{t(`visibility.bot.${bot.token}`)}</s-table-cell>
                        <s-table-cell>{bot.token}</s-table-cell>
                        <s-table-cell>
                          <s-badge
                            tone={
                              bot.allowed
                                ? "success"
                                : purpose === "training"
                                  ? "neutral"
                                  : "critical"
                            }
                          >
                            {t(bot.allowed ? "visibility.allowed" : "visibility.blocked")}
                          </s-badge>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                </s-table-body>
              </s-table>
            </s-stack>
          ))
        )}
        {crawlers?.some((bot) => !bot.allowed) && (
          <s-text color="subdued">{t("visibility.crawlersBlockedHelp")}</s-text>
        )}
      </s-stack>
    </s-section>
  );
}

function FilesSection({ report, t }: { report: VisibilityReport; t: TFunction }) {
  return (
    <s-section heading={t("visibility.filesHeading")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("visibility.filesHelp")}</s-paragraph>
        {report.files.map((file) => (
          <s-stack key={file.path} direction="inline" gap="small-200" alignItems="center">
            <s-link href={file.url} target="_blank">
              {file.path}
            </s-link>
            <s-badge tone={file.found === null ? "neutral" : file.found ? "success" : "warning"}>
              {t(
                file.found === null
                  ? "visibility.file.unknown"
                  : file.found
                    ? "visibility.file.found"
                    : "visibility.file.missing",
              )}
            </s-badge>
          </s-stack>
        ))}
        <s-text color="subdued">{t("visibility.filesChange")}</s-text>
      </s-stack>
    </s-section>
  );
}

export default function SeoPage() {
  const meta = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const report = useFetcher<typeof reportLoader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const requested = useRef(false);

  // স্কোরের যাচাই পেজ খোলার পরে একবার
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void report.load("/app/seo/report");
  }, [report]);

  const job = meta.job;
  const working = Boolean(job?.active);
  const busy = working || fetcher.state !== "idle";

  // কাজ চলার সময় অগ্রগতি নিজে থেকেই নতুন হয় (শুধু এই পেজের তথ্য, স্টোরফ্রন্টের যাচাই আবার হয় না)
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 3000);
    return () => clearInterval(timer);
  }, [working, revalidator]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data.ok) return;
    shopify.toast.show(t(`seoMeta.error.${fetcher.data.error}`), { isError: true });
  }, [fetcher.state, fetcher.data, shopify, t]);

  const send = (intent: "fill" | "undo") =>
    fetcher.submit(JSON.stringify({ intent }), { method: "POST", encType: "application/json" });

  const result = report.data;
  const visibility = result?.ok ? result.report : null;

  return (
    <s-page heading={t("visibility.title")}>
      <ScoreSection
        report={visibility}
        failed={result?.ok === false}
        checking={report.state !== "idle"}
        onCheck={() => void report.load("/app/seo/report")}
        t={t}
      />
      {visibility && <CrawlerSection crawlers={visibility.crawlers} t={t} />}
      {visibility && <FilesSection report={visibility} t={t} />}

      <s-section heading={t("seoMeta.heading")} id="meta">
        <s-stack direction="block" gap="base">
          {!meta.allowed && (
            <s-banner tone="info">
              {t("tools.locked")}. <s-link href="/app/plans">{t("tools.upgrade")}</s-link>
            </s-banner>
          )}
          {meta.allowed && !meta.enabled && (
            <s-banner tone="warning">
              {t("seoMeta.off")}{" "}
              <s-link href="/app/tools/seo-meta-templates">{t("seoMeta.turnOn")}</s-link>
            </s-banner>
          )}
          {job?.kind === "meta-fill" && job.active && (
            <s-banner tone="info">
              {t("seoMeta.filling", { scanned: job.scanned, updated: job.updated })}
            </s-banner>
          )}
          {job?.kind === "meta-fill" && job.status === "done" && job.recent && (
            <s-banner tone="success">
              {t("seoMeta.fillDone", { scanned: job.scanned, updated: job.updated })}
            </s-banner>
          )}
          {job?.kind === "meta-undo" && job.active && (
            <s-banner tone="info">{t("seoMeta.undoing", { restored: job.restored })}</s-banner>
          )}
          {job?.kind === "meta-undo" && job.status === "done" && job.recent && (
            <s-banner tone="success">
              {t("seoMeta.undoDone", { restored: job.restored })}
              {job.kept > 0 ? ` ${t("seoMeta.undoKept", { kept: job.kept })}` : ""}
            </s-banner>
          )}
          {job?.status === "failed" && job.recent && (
            <s-banner tone="critical">{t("seoMeta.failed", { error: job.error ?? "" })}</s-banner>
          )}

          <s-paragraph>{t("seoMeta.help")}</s-paragraph>
          {meta.example && (
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">
                {t("seoMeta.example", { product: meta.example.name })}
              </s-text>
              <s-text type="strong">{meta.example.title || t("seoMeta.exampleEmpty")}</s-text>
              <s-text>{meta.example.description || t("seoMeta.exampleEmpty")}</s-text>
            </s-stack>
          )}
          <s-text color="subdued">
            {t(meta.autoFillNew ? "seoMeta.autoOn" : "seoMeta.autoOff")}
          </s-text>
          <s-stack direction="inline" gap="small">
            <s-button
              variant="primary"
              onClick={() => send("fill")}
              {...(busy ? { loading: true } : {})}
              {...(!meta.enabled ? { disabled: true } : {})}
            >
              {t("seoMeta.fill")}
            </s-button>
            <s-button href="/app/tools/seo-meta-templates">{t("seoMeta.change")}</s-button>
          </s-stack>

          <s-divider />
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">{t("seoMeta.written")}</s-text>
            <s-heading>{meta.written.toLocaleString()}</s-heading>
          </s-stack>
          <s-paragraph>{t("seoMeta.undoHelp")}</s-paragraph>
          <s-stack direction="inline">
            <s-button
              tone="critical"
              onClick={() => {
                if (window.confirm(t("seoMeta.undoConfirm", { count: meta.written }))) {
                  send("undo");
                }
              }}
              {...(busy || meta.written === 0 ? { disabled: true } : {})}
            >
              {t("seoMeta.undo")}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
