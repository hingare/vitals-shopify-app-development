import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { handleToolAction, toolPageData } from "../lib/ai/tool-page.server";
import { CreditsSummary } from "../components/ai/CreditsSummary";
import { AiToolForm, type StartRequest } from "../components/ai/AiForms";
import { AiResults, type ResultAction } from "../components/ai/AiResults";
import { useT } from "../lib/i18n";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return toolPageData(shop, admin, params.toolId ?? "");
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return handleToolAction(shop, admin, params.toolId ?? "", await request.json());
};

const WORKING = ["queued", "running", "applying", "undoing"];

export default function AiToolPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const busy = fetcher.state !== "idle";
  const working = data.generations.some((g) => WORKING.includes(g.status));

  // AI কাজ ব্যাকগ্রাউন্ডে চলে; চলার সময় তালিকা নিজে থেকেই নতুন হয়
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 3000);
    return () => clearInterval(timer);
  }, [working, revalidator]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const result = fetcher.data;
    if (!result.ok) {
      const key =
        result.error === "nothing"
          ? `ai.toast.nothing.${result.intent === "start" ? "start" : "apply"}`
          : `ai.error.${result.error}`;
      shopify.toast.show(t(key), { isError: true });
      return;
    }
    if (result.intent === "applyAll" && result.failed > 0) {
      shopify.toast.show(t("ai.toast.appliedSome", { n: result.count, failed: result.failed }), {
        isError: true,
      });
      return;
    }
    const message: Record<string, string> = {
      start:
        result.count > 1 ? t("ai.toast.startedMany", { n: result.count }) : t("ai.toast.started"),
      retry: t("ai.toast.started"),
      apply: t("ai.toast.applied"),
      applyAll: t("ai.toast.appliedAll", { n: result.count }),
      undo: t("ai.toast.undone"),
      discard: t("ai.toast.discarded"),
    };
    if (message[result.intent]) shopify.toast.show(message[result.intent]!);
  }, [fetcher.state, fetcher.data, shopify, t]);

  const send = (body: ResultAction | (StartRequest & { intent: "start" })) =>
    fetcher.submit(JSON.stringify(body), { method: "POST", encType: "application/json" });

  const outOfCredits = data.credits.limit > 0 && data.credits.left <= 0;
  const canStart = data.allowed && data.ready && data.configured && !outOfCredits;

  return (
    <s-page heading={t(`tool.${data.id}.name`)}>
      <s-link slot="breadcrumb-actions" href="/app/ai">
        {t("nav.ai")}
      </s-link>

      {!data.configured && <s-banner tone="warning">{t("ai.notConfigured")}</s-banner>}
      {!data.allowed && (
        <s-banner tone="info">
          {t("ai.needsProfessional")} <s-link href="/app/plans">{t("tools.upgrade")}</s-link>
        </s-banner>
      )}
      {data.allowed && !data.ready && <s-banner tone="info">{t("ai.notReady")}</s-banner>}
      {data.allowed && outOfCredits && (
        <s-banner tone="critical">{t("ai.credits.outBanner")}</s-banner>
      )}

      <s-section heading={t("ai.form.title")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t(`tool.${data.id}.description`)}</s-paragraph>
          <AiToolForm
            toolId={data.id}
            busy={busy}
            disabled={!canStart}
            storeUrl={data.storeUrl}
            onStart={(request) => send({ intent: "start", ...request })}
          />
        </s-stack>
      </s-section>

      {data.allowed && (
        <AiResults
          toolId={data.id}
          generations={data.generations}
          busy={busy}
          onAction={(action) => send(action)}
        />
      )}

      <CreditsSummary credits={data.credits} slot="aside" />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
