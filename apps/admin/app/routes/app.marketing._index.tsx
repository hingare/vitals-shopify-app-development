import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "@prisma/client";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop } from "../lib/shop.server";
import { listCampaigns } from "../lib/campaigns.server";
import { splitDelay } from "../lib/delay";
import { FLOW_KEYS } from "../lib/email-render";
import { emailSettingsSchema } from "../lib/email-template";
import { getFlows } from "../lib/flows.server";
import { marketingContext } from "../lib/marketing.server";
import { messageStats } from "../lib/messages.server";
import { subscriberCounts } from "../lib/subscribers.server";
import { useT } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [context, flows, campaigns, stats, counts, flowSends] = await Promise.all([
    marketingContext(shop),
    getFlows(shop.id),
    listCampaigns(shop.id),
    messageStats(shop.id, "email", { days: 30 }),
    subscriberCounts(shop.id),
    db.message.groupBy({
      by: ["refId"],
      where: { shopId: shop.id, kind: "flow", status: { in: ["sent", "delivered"] } },
      _count: { _all: true },
    }),
  ]);
  const sentByFlow = new Map(flowSends.map((g) => [g.refId, g._count._all]));
  return {
    ...context,
    stats,
    subscribed: counts.subscribed,
    flows: flows.map((f) => ({
      key: f.key,
      enabled: f.enabled,
      delayMinutes: f.delayMinutes,
      sent: sentByFlow.get(f.key) ?? 0,
    })),
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      recipients: c.recipients,
      when: (c.sentAt ?? c.scheduledAt ?? c.createdAt).toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const parsed = emailSettingsSchema.safeParse(await request.json());
  if (!parsed.success) return { ok: false as const };
  await db.shop.update({
    where: { id: shop.id },
    data: { emailSettings: parsed.data as Prisma.InputJsonValue },
  });
  return { ok: true as const };
};

export default function MarketingPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [settings, setSettings] = useState(data.settings);
  const set = (patch: Partial<typeof settings>) => setSettings({ ...settings, ...patch });

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show(t("marketing.saved"));
    else shopify.toast.show(t("marketing.email.invalid"), { isError: true });
  }, [fetcher.state, fetcher.data, shopify, t]);

  const { stats } = data;
  return (
    <s-page heading={t("marketing.title")}>
      <s-button slot="primary-action" variant="primary" href="/app/marketing/campaigns/new">
        {t("marketing.newCampaign")}
      </s-button>
      <s-button slot="secondary-actions" href="/app/marketing/subscribers">
        {t("marketing.viewSubscribers")}
      </s-button>

      {!data.allowed && (
        <s-banner tone="info">
          {t("tools.locked")}. <s-link href="/app/plans">{t("tools.upgrade")}</s-link>
        </s-banner>
      )}
      {data.allowed && !data.toolEnabled && (
        <s-banner tone="warning">
          {t("marketing.toolOff")}{" "}
          <s-link href="/app/tools/email-marketing">{t("marketing.toolOff.action")}</s-link>
        </s-banner>
      )}
      {!data.configured && <s-banner tone="critical">{t("marketing.notConfigured")}</s-banner>}
      {data.cap > 0 && data.sent >= data.cap && (
        <s-banner tone="warning">{t("marketing.limitReached")}</s-banner>
      )}

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
        <s-section heading={t("marketing.usage")}>
          <s-stack direction="block" gap="small-200">
            <s-heading>
              {t("marketing.usageValue", {
                sent: data.sent.toLocaleString(),
                cap: data.cap.toLocaleString(),
              })}
            </s-heading>
            <s-text color="subdued">{t("marketing.usageHelp")}</s-text>
          </s-stack>
        </s-section>
        <s-section heading={t("marketing.deliveryRate")}>
          <s-stack direction="block" gap="small-200">
            <s-heading>{stats.rate === null ? t("marketing.noSends") : `${stats.rate}%`}</s-heading>
            {stats.rate !== null && (
              <s-text color="subdued">
                {t("marketing.deliveryHelp", {
                  accepted: stats.accepted,
                  bounced: stats.bounced,
                  failed: stats.failed,
                })}
              </s-text>
            )}
          </s-stack>
        </s-section>
        <s-section heading={t("marketing.subscribers")}>
          <s-stack direction="block" gap="small-200">
            <s-heading>{data.subscribed.toLocaleString()}</s-heading>
            <s-link href="/app/marketing/subscribers">{t("marketing.viewSubscribers")}</s-link>
          </s-stack>
        </s-section>
      </s-grid>

      <s-section heading={t("marketing.flows")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("marketing.flowsHelp")}</s-paragraph>
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("marketing.flows")}</s-table-header>
              <s-table-header>{t("subscribers.status")}</s-table-header>
              <s-table-header>{t("marketing.flow.delay")}</s-table-header>
              <s-table-header>{t("marketing.campaign.status.sent")}</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {FLOW_KEYS.map((key) => {
                const flow = data.flows.find((f) => f.key === key);
                if (!flow) return null;
                const delay = splitDelay(flow.delayMinutes);
                return (
                  <s-table-row key={key}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-100">
                        <s-text type="strong">{t(`marketing.flow.${key}`)}</s-text>
                        <s-text color="subdued">{t(`marketing.flow.${key}.help`)}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={flow.enabled ? "success" : "neutral"}>
                        {t(flow.enabled ? "marketing.flow.on" : "marketing.flow.off")}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {delay.value} {t(`marketing.unit.${delay.unit}`).toLowerCase()}
                    </s-table-cell>
                    <s-table-cell>{flow.sent.toLocaleString()}</s-table-cell>
                    <s-table-cell>
                      <s-button href={`/app/marketing/flows/${key}`}>
                        {t("marketing.flow.edit")}
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>

      <s-section heading={t("marketing.campaigns")}>
        {data.campaigns.length === 0 ? (
          <s-text color="subdued">{t("marketing.campaignsEmpty")}</s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("marketing.campaign.name")}</s-table-header>
              <s-table-header>{t("subscribers.status")}</s-table-header>
              <s-table-header>{t("marketing.campaign.recipients")}</s-table-header>
              <s-table-header>{t("subscribers.added")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.campaigns.map((campaign) => (
                <s-table-row key={campaign.id}>
                  <s-table-cell>
                    <s-link href={`/app/marketing/campaigns/${campaign.id}`}>
                      {campaign.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={campaign.status === "sent" ? "success" : "neutral"}>
                      {t(`marketing.campaign.status.${campaign.status}`)}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {campaign.status === "draft" || campaign.status === "scheduled"
                      ? "–"
                      : campaign.recipients.toLocaleString()}
                  </s-table-cell>
                  <s-table-cell>{new Date(campaign.when).toLocaleString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={t("marketing.sender")}>
        <s-stack direction="block" gap="base">
          <s-text-field
            label={t("marketing.senderName")}
            details={t("marketing.senderNameHelp")}
            maxLength={60}
            value={settings.senderName}
            onChange={(e) => set({ senderName: e.currentTarget.value })}
          />
          <s-email-field
            label={t("marketing.replyTo")}
            details={t("marketing.replyToHelp")}
            value={settings.replyTo}
            onChange={(e) => set({ replyTo: e.currentTarget.value })}
          />
          <s-text-area
            label={t("marketing.postalAddress")}
            details={t("marketing.postalAddressHelp")}
            rows={3}
            maxLength={300}
            value={settings.postalAddress}
            onChange={(e) => set({ postalAddress: e.currentTarget.value })}
          />
          <s-color-field
            label={t("marketing.accent")}
            value={settings.accent}
            onChange={(e) => set({ accent: e.currentTarget.value })}
          />
          <s-button
            onClick={() =>
              fetcher.submit(JSON.stringify(settings), {
                method: "POST",
                encType: "application/json",
              })
            }
            {...(fetcher.state !== "idle" ? { loading: true } : {})}
          >
            {t("marketing.saveSender")}
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
