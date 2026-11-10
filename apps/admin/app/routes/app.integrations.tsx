import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  EMAIL_TOOLS,
  EMAIL_TOOL_IDS,
  IntegrationError,
  isEmailToolId,
  normalizePhone,
  sendSms,
  type ProviderList,
} from "@app/integrations";
// ফর্মে লাগে এমন ধ্রুবক আলাদা ফাইল থেকে, যাতে সার্ভারের কোড ব্রাউজারে না যায়
import { SMS_GATEWAYS } from "@app/integrations/constants";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop } from "../lib/shop.server";
import { SKIP_LIST, SYNC_SOURCES } from "../lib/integration-options";
import {
  SMS_PROVIDER,
  connectEmailTool,
  disconnectIntegration,
  listIntegrations,
  providerLists,
  readEspConfig,
  saveEspConfig,
  saveSmsGateway,
  smsGateway,
} from "../lib/integrations.server";
import { allowTestSend } from "../lib/marketing.server";
import { messageStats, shopDisplayName } from "../lib/messages.server";
import { enqueueJob } from "../lib/queue.server";
import { useT } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [rows, backfills, smsStats] = await Promise.all([
    listIntegrations(shop.id),
    db.job.findMany({
      where: { shopId: shop.id, kind: "esp-backfill" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    messageStats(shop.id, "sms", { days: 30 }),
  ]);

  const tools = await Promise.all(
    EMAIL_TOOL_IDS.map(async (id) => {
      const row = rows.find((r) => r.provider === id);
      let lists: ProviderList[] = [];
      let listsError: string | null = null;
      if (row && EMAIL_TOOLS[id].hasLists) {
        try {
          lists = await providerLists(shop.id, id);
        } catch (error) {
          listsError = error instanceof Error ? error.message : String(error);
        }
      }
      const job = backfills.find((j) => (j.payload as { provider?: string }).provider === id);
      return {
        id,
        hasLists: EMAIL_TOOLS[id].hasLists,
        connected: Boolean(row),
        status: row?.status ?? null,
        keyHint: row?.keyHint ?? "",
        lastError: row?.lastError ?? null,
        lastSyncAt: row?.lastSyncAt ?? null,
        config: readEspConfig(row?.config),
        lists,
        listsError,
        backfill: job
          ? {
              status: job.status,
              error: job.error,
              done: ((job.progress ?? {}) as { done?: number }).done ?? 0,
            }
          : null,
      };
    }),
  );

  const sms = rows.find((r) => r.provider === SMS_PROVIDER);
  const smsConfig = (sms?.config ?? {}) as {
    gateway?: string;
    senderId?: string;
    customSuccess?: string;
    savedAt?: string;
  };
  return {
    tools,
    sms: {
      connected: Boolean(sms),
      keyHint: sms?.keyHint ?? "",
      gateway: smsConfig.gateway ?? "alpha-sms",
      senderId: smsConfig.senderId ?? "",
      customSuccess: smsConfig.customSuccess ?? "",
      lastError: sms?.lastError ?? null,
      // সেভের পরে ফর্ম নতুন করে শুরু করতে (চাবির ঘর ফাঁকা হয়)
      savedAt: smsConfig.savedAt ?? "",
      stats: smsStats,
    },
  };
};

type Result = { ok: true; intent: string } | { ok: false; intent: string; error: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as Record<string, unknown>;
  const intent = String(body.intent ?? "");
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");
  const provider = text("provider");

  try {
    switch (intent) {
      case "connect":
        if (!isEmailToolId(provider)) break;
        await connectEmailTool(shop.id, provider, text("apiKey"));
        break;
      case "disconnect":
        if (isEmailToolId(provider) || provider === SMS_PROVIDER) {
          await disconnectIntegration(shop.id, provider);
        }
        break;
      case "lists":
        if (isEmailToolId(provider)) await saveEspConfig(shop.id, provider, body.config);
        break;
      case "backfill":
        if (isEmailToolId(provider)) await enqueueJob(shop.id, "esp-backfill", { provider });
        break;
      case "sms-save":
        await saveSmsGateway(shop.id, {
          gateway: text("gateway"),
          apiKey: text("apiKey"),
          senderId: text("senderId"),
          customUrl: text("customUrl"),
          customSuccess: text("customSuccess"),
        });
        break;
      case "sms-test": {
        const to = normalizePhone(text("to"), "BD") ?? normalizePhone(text("to"), "");
        if (!to) return { ok: false, intent, error: "bad_phone" } satisfies Result;
        if (!allowTestSend(shop.id, "sms")) {
          return { ok: false, intent, error: "rate_limited" } satisfies Result;
        }
        const gateway = await smsGateway(shop.id);
        if (!gateway) return { ok: false, intent, error: "sms_not_configured" } satisfies Result;
        const message = `Test SMS from ${shopDisplayName(shop)}`;
        const result = await sendSms(gateway, to, message);
        await db.message.create({
          data: {
            shopId: shop.id,
            channel: "sms",
            kind: "test",
            recipient: to,
            payload: { text: message },
            status: result.ok ? "sent" : "failed",
            error: result.ok ? null : (result.error ?? "send_failed").slice(0, 300),
            providerId: result.id ?? null,
            sentAt: result.ok ? new Date() : null,
            attempts: 1,
          },
        });
        await db.integration.updateMany({
          where: { shopId: shop.id, provider: SMS_PROVIDER },
          data: result.ok
            ? { status: "connected", lastError: null, lastSyncAt: new Date() }
            : { status: "error", lastError: (result.error ?? "send_failed").slice(0, 300) },
        });
        if (!result.ok) {
          return { ok: false, intent, error: result.error ?? "send_failed" } satisfies Result;
        }
        break;
      }
    }
  } catch (error) {
    // ভুল চাবি বা ভুল ফর্ম: বার্তাটা মার্চেন্টকে দেখাই
    if (error instanceof IntegrationError) {
      return { ok: false, intent, error: error.message } satisfies Result;
    }
    throw error;
  }
  return { ok: true, intent } satisfies Result;
};

type Tool = ReturnType<typeof useLoaderData<typeof loader>>["tools"][number];
type Send = (payload: Record<string, unknown>) => void;

function EmailToolCard({ tool, send, busy }: { tool: Tool; send: Send; busy: string | null }) {
  const t = useT();
  const [apiKey, setApiKey] = useState("");
  const [config, setConfig] = useState(tool.config);
  const name = t(`integrations.${tool.id}`);
  const loading = (intent: string) => (busy === `${intent}:${tool.id}` ? { loading: true } : {});
  const running = tool.backfill?.status === "pending" || tool.backfill?.status === "running";

  return (
    <s-section heading={name}>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-badge
            tone={!tool.connected ? "neutral" : tool.status === "error" ? "critical" : "success"}
          >
            {t(
              !tool.connected
                ? "integrations.notConnected"
                : tool.status === "error"
                  ? "integrations.error"
                  : "integrations.connected",
            )}
          </s-badge>
          {tool.connected && (
            <s-text color="subdued">{t("integrations.keyEnding", { hint: tool.keyHint })}</s-text>
          )}
        </s-stack>

        {!tool.connected ? (
          <s-stack direction="block" gap="small">
            <s-password-field
              label={t("integrations.apiKey")}
              details={t(`integrations.${tool.id}.keyHelp`)}
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
            />
            <s-stack direction="inline">
              <s-button
                variant="primary"
                onClick={() => send({ intent: "connect", provider: tool.id, apiKey })}
                {...(apiKey.trim() ? {} : { disabled: true })}
                {...loading("connect")}
              >
                {t("integrations.connect")}
              </s-button>
            </s-stack>
          </s-stack>
        ) : (
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              {tool.lastSyncAt
                ? t("integrations.lastSync", { when: new Date(tool.lastSyncAt).toLocaleString() })
                : t("integrations.neverSynced")}
            </s-text>
            {tool.lastError && (
              <s-banner tone="critical">
                {t("integrations.lastError", { error: tool.lastError })}
              </s-banner>
            )}
            {tool.listsError && (
              <s-banner tone="warning">
                {t("integrations.listsFailed", { error: tool.listsError })}
              </s-banner>
            )}

            {tool.hasLists && (
              <s-stack direction="block" gap="small">
                <s-select
                  label={t("integrations.defaultList")}
                  value={config.defaultList}
                  onChange={(e) => setConfig({ ...config, defaultList: e.currentTarget.value })}
                >
                  <s-option value="">{t("integrations.noList")}</s-option>
                  {tool.lists.map((list) => (
                    <s-option key={list.id} value={list.id}>
                      {list.name}
                    </s-option>
                  ))}
                </s-select>
                {SYNC_SOURCES.map((source) => (
                  <s-select
                    key={source}
                    label={t("integrations.listFor", { source: t(`subscribers.source.${source}`) })}
                    value={config.lists[source] ?? ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        lists: { ...config.lists, [source]: e.currentTarget.value },
                      })
                    }
                  >
                    <s-option value="">{t("integrations.useDefault")}</s-option>
                    <s-option value={SKIP_LIST}>{t("integrations.dontSend")}</s-option>
                    {tool.lists.map((list) => (
                      <s-option key={list.id} value={list.id}>
                        {list.name}
                      </s-option>
                    ))}
                  </s-select>
                ))}
                <s-stack direction="inline">
                  <s-button
                    onClick={() => send({ intent: "lists", provider: tool.id, config })}
                    {...loading("lists")}
                  >
                    {t("integrations.saveLists")}
                  </s-button>
                </s-stack>
              </s-stack>
            )}

            {tool.backfill && running && (
              <s-text>{t("integrations.syncRunning", { done: tool.backfill.done })}</s-text>
            )}
            {tool.backfill?.status === "done" && (
              <s-text color="subdued">
                {t("integrations.syncDone", { done: tool.backfill.done })}
              </s-text>
            )}
            {tool.backfill?.status === "failed" && (
              <s-banner tone="critical">
                {t("integrations.syncFailed", { error: tool.backfill.error ?? "" })}
              </s-banner>
            )}
            <s-stack direction="inline" gap="small">
              <s-button
                onClick={() => send({ intent: "backfill", provider: tool.id })}
                {...(running ? { loading: true } : loading("backfill"))}
              >
                {t("integrations.syncAll")}
              </s-button>
              <s-button
                tone="critical"
                variant="tertiary"
                onClick={() => {
                  if (window.confirm(t("integrations.confirmDisconnect", { name }))) {
                    send({ intent: "disconnect", provider: tool.id });
                  }
                }}
              >
                {t("integrations.disconnect")}
              </s-button>
            </s-stack>
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

type Sms = ReturnType<typeof useLoaderData<typeof loader>>["sms"];

function SmsGatewayCard({ sms, send, busy }: { sms: Sms; send: Send; busy: string | null }) {
  const t = useT();
  const [form, setForm] = useState({
    gateway: sms.gateway,
    apiKey: "",
    senderId: sms.senderId,
    customUrl: "",
    customSuccess: sms.customSuccess,
  });
  const [testTo, setTestTo] = useState("");
  const loading = (intent: string) => (busy === `${intent}:` ? { loading: true } : {});
  const stats = sms.stats;

  return (
    <s-section heading={t("integrations.sms")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("integrations.smsHelp")}</s-paragraph>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-badge tone={!sms.connected ? "neutral" : sms.lastError ? "critical" : "success"}>
            {t(sms.connected ? "integrations.connected" : "integrations.notConnected")}
          </s-badge>
          {stats.accepted + stats.failed + stats.skipped > 0 && (
            <s-text color="subdued">
              {t("integrations.sms.stats")}:{" "}
              {t("integrations.sms.statsValue", {
                accepted: stats.accepted,
                failed: stats.failed,
                skipped: stats.skipped,
              })}
            </s-text>
          )}
        </s-stack>
        {sms.lastError && (
          <s-banner tone="critical">
            {t("integrations.lastError", { error: sms.lastError })}
          </s-banner>
        )}

        <s-select
          label={t("integrations.sms.gateway")}
          value={form.gateway}
          onChange={(e) => setForm({ ...form, gateway: e.currentTarget.value })}
        >
          {SMS_GATEWAYS.map((gateway) => (
            <s-option key={gateway} value={gateway}>
              {t(`integrations.sms.${gateway}`)}
            </s-option>
          ))}
        </s-select>
        <s-password-field
          label={t("integrations.sms.apiKey")}
          {...(sms.connected
            ? { details: t("integrations.sms.apiKeyKeep", { hint: sms.keyHint }) }
            : {})}
          value={form.apiKey}
          onChange={(e) => setForm({ ...form, apiKey: e.currentTarget.value })}
        />
        <s-text-field
          label={t("integrations.sms.senderId")}
          details={t("integrations.sms.senderIdHelp")}
          maxLength={30}
          value={form.senderId}
          onChange={(e) => setForm({ ...form, senderId: e.currentTarget.value })}
        />
        {form.gateway === "custom" && (
          <>
            <s-url-field
              label={t("integrations.sms.customUrl")}
              details={`${t("integrations.sms.customUrlHelp")}${
                sms.connected && sms.gateway === "custom"
                  ? ` ${t("integrations.sms.customUrlKeep")}`
                  : ""
              }`}
              value={form.customUrl}
              onChange={(e) => setForm({ ...form, customUrl: e.currentTarget.value })}
            />
            <s-text-field
              label={t("integrations.sms.customSuccess")}
              details={t("integrations.sms.customSuccessHelp")}
              maxLength={60}
              value={form.customSuccess}
              onChange={(e) => setForm({ ...form, customSuccess: e.currentTarget.value })}
            />
          </>
        )}
        <s-stack direction="inline" gap="small">
          <s-button
            variant="primary"
            onClick={() => send({ intent: "sms-save", ...form })}
            {...loading("sms-save")}
          >
            {t("integrations.sms.save")}
          </s-button>
          {sms.connected && (
            <s-button
              tone="critical"
              variant="tertiary"
              onClick={() => {
                const question = t("integrations.confirmDisconnect", {
                  name: t("integrations.sms"),
                });
                if (window.confirm(question)) send({ intent: "disconnect", provider: "sms" });
              }}
            >
              {t("integrations.disconnect")}
            </s-button>
          )}
        </s-stack>

        {sms.connected && (
          <>
            <s-divider />
            <s-stack direction="inline" gap="small" alignItems="end">
              <s-text-field
                label={t("integrations.sms.testTo")}
                value={testTo}
                onChange={(e) => setTestTo(e.currentTarget.value)}
              />
              <s-button
                onClick={() => send({ intent: "sms-test", to: testTo })}
                {...(testTo.trim() ? {} : { disabled: true })}
                {...loading("sms-test")}
              >
                {t("integrations.sms.sendTest")}
              </s-button>
            </s-stack>
          </>
        )}
      </s-stack>
    </s-section>
  );
}

export default function IntegrationsPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const submitted = fetcher.json as { intent?: string; provider?: string } | undefined;
  const busy =
    fetcher.state !== "idle" && submitted
      ? `${submitted.intent}:${submitted.provider ?? ""}`
      : null;
  const syncing = data.tools.some(
    (tool) => tool.backfill?.status === "pending" || tool.backfill?.status === "running",
  );

  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 4000);
    return () => clearInterval(timer);
  }, [syncing, revalidator]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const result = fetcher.data;
    if (result.ok) {
      shopify.toast.show(
        t(result.intent === "sms-test" ? "integrations.sms.testSent" : "integrations.saved"),
      );
      return;
    }
    const messages: Record<string, string> = {
      bad_phone: t("integrations.sms.badPhone"),
      rate_limited: t("marketing.email.tooMany"),
      sms_not_configured: t("integrations.sms.notSaved"),
    };
    const message =
      messages[result.error] ??
      (result.intent === "sms-test"
        ? t("integrations.sms.testFailed", { error: result.error })
        : result.error);
    shopify.toast.show(message, { isError: true });
  }, [fetcher.state, fetcher.data, shopify, t]);

  const send: Send = (payload) =>
    fetcher.submit(JSON.stringify(payload), { method: "POST", encType: "application/json" });

  return (
    <s-page heading={t("integrations.title")}>
      <s-section heading={t("integrations.emailTools")}>
        <s-paragraph>{t("integrations.emailToolsHelp")}</s-paragraph>
      </s-section>
      {data.tools.map((tool) => (
        // সংযোগ বদলালে কার্ডের ভেতরের ফর্ম নতুন করে শুরু হয়
        <EmailToolCard key={`${tool.id}:${tool.connected}`} tool={tool} send={send} busy={busy} />
      ))}
      <SmsGatewayCard key={data.sms.savedAt} sms={data.sms} send={send} busy={busy} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
