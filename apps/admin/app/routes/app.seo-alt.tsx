import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { seoAltTags } from "@app/tools";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { altOverview, startAltJob } from "../lib/seo-alt.server";
import { enabledSettings } from "../lib/tool-state.server";
import { useT } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return altOverview(admin, shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as { intent?: string };
  if (body.intent === "fill") {
    if (!(await enabledSettings(shop, seoAltTags))) return { ok: false as const, error: "off" };
    const started = await startAltJob(shop.id, "alt-fill");
    return started ? { ok: true as const } : { ok: false as const, error: "busy" };
  }
  if (body.intent === "undo") {
    // টুল বন্ধ থাকলেও আগের অবস্থায় ফেরানো যায়
    const started = await startAltJob(shop.id, "alt-undo");
    return started ? { ok: true as const } : { ok: false as const, error: "busy" };
  }
  return { ok: false as const, error: "unknown" };
};

export default function SeoAltPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const job = data.job;
  const working = Boolean(job?.active);
  const busy = working || fetcher.state !== "idle";

  // কাজ চলার সময় অগ্রগতি নিজে থেকেই নতুন হয়
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 3000);
    return () => clearInterval(timer);
  }, [working, revalidator]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data.ok) return;
    shopify.toast.show(t(`seoAlt.error.${fetcher.data.error}`), { isError: true });
  }, [fetcher.state, fetcher.data, shopify, t]);

  const send = (intent: "fill" | "undo") =>
    fetcher.submit(JSON.stringify({ intent }), { method: "POST", encType: "application/json" });

  return (
    <s-page heading={t("seoAlt.title")}>
      <s-link slot="breadcrumb-actions" href="/app/tools">
        {t("nav.tools")}
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => send("fill")}
        {...(busy ? { loading: true } : {})}
        {...(!data.enabled ? { disabled: true } : {})}
      >
        {t("seoAlt.fill")}
      </s-button>

      {!data.allowed && (
        <s-banner tone="info">
          {t("tools.locked")}. <s-link href="/app/plans">{t("tools.upgrade")}</s-link>
        </s-banner>
      )}
      {data.allowed && !data.enabled && (
        <s-banner tone="warning">
          {t("seoAlt.off")} <s-link href="/app/tools/seo-alt-tags">{t("seoAlt.turnOn")}</s-link>
        </s-banner>
      )}

      {job?.kind === "alt-fill" && job.active && (
        <s-banner tone="info">
          {t("seoAlt.filling", { scanned: job.scanned, updated: job.updated })}
        </s-banner>
      )}
      {job?.kind === "alt-fill" && job.status === "done" && job.recent && (
        <s-banner tone="success">
          {t("seoAlt.fillDone", { scanned: job.scanned, updated: job.updated })}
        </s-banner>
      )}
      {job?.kind === "alt-undo" && job.active && (
        <s-banner tone="info">{t("seoAlt.undoing", { restored: job.restored })}</s-banner>
      )}
      {job?.kind === "alt-undo" && job.status === "done" && job.recent && (
        <s-banner tone="success">
          {t("seoAlt.undoDone", { restored: job.restored })}
          {job.kept > 0 ? ` ${t("seoAlt.undoKept", { kept: job.kept })}` : ""}
        </s-banner>
      )}
      {job?.status === "failed" && job.recent && (
        <s-banner tone="critical">{t("seoAlt.failed", { error: job.error ?? "" })}</s-banner>
      )}

      <s-section heading={t("seoAlt.howHeading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("seoAlt.help")}</s-paragraph>
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">{t("field.altTemplate")}</s-text>
            <s-text>{data.template}</s-text>
          </s-stack>
          {data.example !== null && (
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">{t("seoAlt.example")}</s-text>
              <s-text>{data.example || t("seoAlt.exampleEmpty")}</s-text>
            </s-stack>
          )}
          <s-text color="subdued">{t(data.autoNew ? "seoAlt.autoOn" : "seoAlt.autoOff")}</s-text>
          <s-stack direction="inline">
            <s-button href="/app/tools/seo-alt-tags">{t("seoAlt.change")}</s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading={t("seoAlt.undoHeading")}>
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">{t("seoAlt.written")}</s-text>
            <s-heading>{data.written.toLocaleString()}</s-heading>
          </s-stack>
          <s-paragraph>{t("seoAlt.undoHelp")}</s-paragraph>
          <s-stack direction="inline">
            <s-button
              tone="critical"
              onClick={() => {
                if (window.confirm(t("seoAlt.undoConfirm", { count: data.written }))) send("undo");
              }}
              {...(busy || data.written === 0 ? { disabled: true } : {})}
            >
              {t("seoAlt.undo")}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
