import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { pushNotifications } from "@app/tools";
import { canUseTool, type AnyTool } from "@app/tool-sdk";

import { authenticate } from "../shopify.server";
import { ensureShop, planOf } from "../lib/shop.server";
import {
  PushError,
  createPushCampaign,
  listPushCampaigns,
  pushSubscriberCount,
} from "../lib/push.server";
import { allowRequest } from "../lib/rate-limit.server";
import { enabledSettings } from "../lib/tool-state.server";
import { useT } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const plan = planOf(shop);
  const [settings, subscribers, campaigns] = await Promise.all([
    enabledSettings(shop, pushNotifications),
    pushSubscriberCount(shop.id),
    listPushCampaigns(shop.id),
  ]);
  return {
    allowed: plan !== null && canUseTool(pushNotifications as unknown as AnyTool, plan),
    toolEnabled: settings !== null,
    subscribers,
    campaigns: campaigns.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      sent: c.sent,
      failed: c.failed,
      clicks: c.clicks,
      createdAt: c.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as { title?: unknown; body?: unknown; url?: unknown };
  // ভুল করে পরপর কয়েকবার চাপলে একই নোটিফিকেশন বারবার না যায়
  if (!allowRequest(`push-send:${shop.id}`, 3, 60_000)) {
    return { ok: false as const, error: "rate_limited" };
  }
  try {
    await createPushCampaign(shop, body);
    return { ok: true as const };
  } catch (error) {
    if (error instanceof PushError) return { ok: false as const, error: error.message };
    throw error;
  }
};

export default function PushPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [form, setForm] = useState({ title: "", body: "", url: "" });
  const sending = data.campaigns.some((c) => c.status !== "sent");

  // পাঠানো চলাকালীন সংখ্যাগুলো কয়েক সেকেন্ড পরপর নতুন করে আনা
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 4000);
    return () => clearInterval(timer);
  }, [sending, revalidator]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      shopify.toast.show(t("marketing.push.started"));
      return;
    }
    const messages: Record<string, string> = {
      invalid: t("marketing.push.invalid"),
      tool_off: t("marketing.push.toolOff"),
      rate_limited: t("marketing.email.tooMany"),
    };
    shopify.toast.show(messages[fetcher.data.error] ?? fetcher.data.error, { isError: true });
  }, [fetcher.state, fetcher.data, shopify, t]);

  function send() {
    if (!window.confirm(t("marketing.push.confirm", { n: data.subscribers }))) return;
    fetcher.submit(JSON.stringify(form), { method: "POST", encType: "application/json" });
  }

  const canSend = data.allowed && data.toolEnabled && data.subscribers > 0;
  return (
    <s-page heading={t("marketing.push")}>
      <s-link slot="breadcrumb-actions" href="/app/marketing">
        {t("marketing.back")}
      </s-link>

      {!data.allowed && (
        <s-banner tone="info">
          {t("tools.locked")}. <s-link href="/app/plans">{t("tools.upgrade")}</s-link>
        </s-banner>
      )}
      {data.allowed && !data.toolEnabled && (
        <s-banner tone="warning">
          {t("marketing.push.toolOff")}{" "}
          <s-link href="/app/tools/push-notifications">{t("marketing.toolOff.action")}</s-link>
        </s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="small-200">
          <s-paragraph>{t("marketing.push.help")}</s-paragraph>
          <s-text color="subdued">{t("marketing.push.subscribers")}</s-text>
          <s-heading>{data.subscribers.toLocaleString()}</s-heading>
        </s-stack>
      </s-section>

      <s-section heading={t("marketing.push.new")}>
        <s-stack direction="block" gap="base">
          <s-text-field
            label={t("marketing.push.titleField")}
            maxLength={80}
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.currentTarget.value })}
          />
          <s-text-area
            label={t("marketing.push.bodyField")}
            rows={3}
            maxLength={200}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.currentTarget.value })}
          />
          <s-text-field
            label={t("marketing.push.urlField")}
            details={t("marketing.push.urlHelp")}
            maxLength={500}
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.currentTarget.value })}
          />
          {data.subscribers === 0 && <s-text color="subdued">{t("marketing.push.none")}</s-text>}
          <s-stack direction="inline">
            <s-button
              variant="primary"
              onClick={send}
              {...(canSend && form.title.trim() ? {} : { disabled: true })}
              {...(fetcher.state !== "idle" ? { loading: true } : {})}
            >
              {t("marketing.push.send")}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading={t("marketing.push.history")}>
        {data.campaigns.length === 0 ? (
          <s-text color="subdued">{t("marketing.push.empty")}</s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("marketing.push.titleField")}</s-table-header>
              <s-table-header>{t("subscribers.status")}</s-table-header>
              <s-table-header>{t("marketing.push.sent")}</s-table-header>
              <s-table-header>{t("marketing.push.failed")}</s-table-header>
              <s-table-header>{t("marketing.push.clicks")}</s-table-header>
              <s-table-header>{t("subscribers.added")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.campaigns.map((campaign) => (
                <s-table-row key={campaign.id}>
                  <s-table-cell>{campaign.title}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={campaign.status === "sent" ? "success" : "neutral"}>
                      {t(`marketing.push.status.${campaign.status}`)}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{campaign.sent.toLocaleString()}</s-table-cell>
                  <s-table-cell>{campaign.failed.toLocaleString()}</s-table-cell>
                  <s-table-cell>{campaign.clicks.toLocaleString()}</s-table-cell>
                  <s-table-cell>{new Date(campaign.createdAt).toLocaleString()}</s-table-cell>
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
