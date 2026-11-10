import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { sendTestEmail } from "../lib/campaigns.server";
import { DELAY_UNITS, joinDelay, splitDelay, type DelayUnit } from "../lib/delay";
import type { FlowKey } from "../lib/email-render";
import { FLOWS, flowContentSchema, isFlowKey } from "../lib/email-template";
import { getFlows, saveFlow } from "../lib/flows.server";
import { allowTestSend, marketingContext } from "../lib/marketing.server";
import { messageStats } from "../lib/messages.server";
import { useT } from "../lib/i18n";
import { EmailFields, EmailPreview, TestSend } from "../components/EmailEditor";

/** প্রতিটা flow-র লেখায় যে নামগুলো বসানো যায় */
const VARS: Record<FlowKey, string> = {
  welcome: "{first_name}, {shop}",
  "abandoned-checkout": "{first_name}, {shop}",
  "review-request": "{first_name}, {shop}, {product}, {order}",
  winback: "{first_name}, {shop}",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const key = params.key;
  if (!isFlowKey(key)) throw new Response("Not found", { status: 404 });
  const shop = await ensureShop(session.shop);
  const [context, flows, stats] = await Promise.all([
    marketingContext(shop),
    getFlows(shop.id),
    messageStats(shop.id, { kind: "flow", refId: key }),
  ]);
  const flow = flows.find((f) => f.key === key)!;
  return {
    key,
    enabled: flow.enabled,
    delayMinutes: flow.delayMinutes,
    content: flow.content,
    minDelay: FLOWS[key].minDelay,
    maxDelay: FLOWS[key].maxDelay,
    stats,
    look: context.look,
    storeUrl: context.storeUrl,
    configured: context.configured,
    allowed: context.allowed,
    toolEnabled: context.toolEnabled,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const key = params.key;
  if (!isFlowKey(key)) throw new Response("Not found", { status: 404 });
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as {
    intent?: string;
    enabled?: boolean;
    delayMinutes?: number;
    content?: unknown;
    to?: string;
  };
  const content = flowContentSchema.safeParse(body.content);
  if (!content.success) return { ok: false as const, intent: body.intent, error: "invalid" };

  if (body.intent === "test") {
    if (!allowTestSend(shop.id)) {
      return { ok: false as const, intent: "test", error: "rate_limited" };
    }
    const result = await sendTestEmail(
      shop,
      { ...content.data, buttonUrl: `https://${shop.domain}`, imageUrl: "" },
      body.to,
    );
    return result.ok
      ? { ok: true as const, intent: "test" }
      : { ok: false as const, intent: "test", error: result.error ?? "send_failed" };
  }
  await saveFlow(shop.id, key, {
    enabled: body.enabled === true,
    delayMinutes: Number(body.delayMinutes),
    content: content.data,
  });
  return { ok: true as const, intent: "save" };
};

export default function FlowPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [enabled, setEnabled] = useState(data.enabled);
  const [content, setContent] = useState(data.content);
  const [delay, setDelay] = useState(splitDelay(data.delayMinutes));
  const busy = fetcher.state !== "idle";
  const intent = (fetcher.json as { intent?: string } | undefined)?.intent;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const result = fetcher.data;
    if (result.ok) {
      shopify.toast.show(
        t(result.intent === "test" ? "marketing.email.testSent" : "marketing.saved"),
      );
    } else if (result.error === "invalid") {
      shopify.toast.show(t("marketing.email.invalid"), { isError: true });
    } else if (result.error === "email_not_configured") {
      shopify.toast.show(t("marketing.notConfigured"), { isError: true });
    } else if (result.error === "rate_limited") {
      shopify.toast.show(t("marketing.email.tooMany"), { isError: true });
    } else {
      shopify.toast.show(t("marketing.email.testFailed", { error: result.error }), {
        isError: true,
      });
    }
  }, [fetcher.state, fetcher.data, shopify, t]);

  const submit = (payload: Record<string, unknown>) =>
    fetcher.submit(JSON.stringify({ content, ...payload }), {
      method: "POST",
      encType: "application/json",
    });

  function save() {
    // সার্ভারও দেরিটা অনুমোদিত সীমার মধ্যে আনে; এখানে একই হিসাব করে ঘরে সেই মানটাই দেখাই
    const asked = joinDelay(delay.value, delay.unit);
    const minutes = Math.min(data.maxDelay, Math.max(data.minDelay, asked));
    if (minutes !== asked) setDelay(splitDelay(minutes));
    submit({ intent: "save", enabled, delayMinutes: minutes });
  }

  return (
    <s-page heading={t(`marketing.flow.${data.key}`)}>
      <s-link slot="breadcrumb-actions" href="/app/marketing">
        {t("marketing.back")}
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        {...(busy && intent === "save" ? { loading: true } : {})}
      >
        {t("tools.save")}
      </s-button>

      {data.allowed && !data.toolEnabled && (
        <s-banner tone="warning">
          {t("marketing.toolOff")}{" "}
          <s-link href="/app/tools/email-marketing">{t("marketing.toolOff.action")}</s-link>
        </s-banner>
      )}
      {!data.configured && <s-banner tone="critical">{t("marketing.notConfigured")}</s-banner>}

      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t(`marketing.flow.${data.key}.help`)}</s-paragraph>
          <s-switch
            label={t("marketing.flow.enabled")}
            checked={enabled}
            onChange={() => setEnabled(!enabled)}
          />
          <s-stack direction="inline" gap="small" alignItems="end">
            <s-number-field
              label={t("marketing.flow.delay")}
              min={0}
              value={String(delay.value)}
              onChange={(e) => setDelay({ ...delay, value: Number(e.currentTarget.value) || 0 })}
            />
            <s-select
              label={t("marketing.flow.delay")}
              labelAccessibilityVisibility="exclusive"
              value={delay.unit}
              onChange={(e) => setDelay({ ...delay, unit: e.currentTarget.value as DelayUnit })}
            >
              {(Object.keys(DELAY_UNITS) as DelayUnit[]).map((unit) => (
                <s-option key={unit} value={unit}>
                  {t(`marketing.unit.${unit}`)}
                </s-option>
              ))}
            </s-select>
          </s-stack>
          {data.stats.accepted + data.stats.bounced + data.stats.failed > 0 && (
            <s-text color="subdued">
              {t("marketing.deliveryHelp", {
                accepted: data.stats.accepted,
                bounced: data.stats.bounced,
                failed: data.stats.failed,
              })}
            </s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading={t("marketing.email.body")}>
        <EmailFields
          content={content}
          onChange={setContent}
          withLinks={false}
          vars={VARS[data.key]}
        />
      </s-section>

      <s-section heading={t("marketing.email.sendTest")}>
        <TestSend
          sending={busy && intent === "test"}
          onSend={(to) => submit({ intent: "test", to })}
        />
      </s-section>

      <s-section slot="aside" heading={t("marketing.email.preview")}>
        <EmailPreview content={content} look={data.look} fallbackUrl={data.storeUrl} />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
