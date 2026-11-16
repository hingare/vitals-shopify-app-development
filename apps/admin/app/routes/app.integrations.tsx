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
  type ProviderList,
} from "@app/integrations";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop } from "../lib/shop.server";
import { SKIP_LIST, SYNC_SOURCES } from "../lib/integration-options";
import {
  connectEmailTool,
  disconnectIntegration,
  listIntegrations,
  providerLists,
  readEspConfig,
  saveEspConfig,
} from "../lib/integrations.server";
import { enqueueJob } from "../lib/queue.server";
import { useT } from "../lib/i18n";
import { useConfirm } from "../components/ConfirmModal";
import { FormSaveBar } from "../components/FormSaveBar";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [rows, backfills] = await Promise.all([
    listIntegrations(shop.id),
    db.job.findMany({
      where: { shopId: shop.id, kind: "esp-backfill" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
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

  return { tools };
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
        if (isEmailToolId(provider)) await disconnectIntegration(shop.id, provider);
        break;
      case "lists": {
        // সেভ বার একসাথে সব বদলানো সংযোগের তালিকা পাঠায়
        const configs = (body.configs ?? {}) as Record<string, unknown>;
        for (const [id, config] of Object.entries(configs)) {
          if (isEmailToolId(id)) await saveEspConfig(shop.id, id, config);
        }
        break;
      }
      case "backfill":
        if (isEmailToolId(provider)) await enqueueJob(shop.id, "esp-backfill", { provider });
        break;
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
type Config = Tool["config"];
type Send = (payload: Record<string, unknown>) => Promise<void>;

function EmailToolCard({
  tool,
  config,
  setConfig,
  forget,
  send,
  busy,
}: {
  tool: Tool;
  /** তালিকার বাছাই; সেভ হয় পাতার সেভ বার দিয়ে */
  config: Config;
  setConfig: (config: Config) => void;
  /** সংযোগ কাটলে এই সংযোগের না-সেভ-করা বদল ভুলে যাওয়া */
  forget: () => void;
  send: Send;
  busy: string | null;
}) {
  const t = useT();
  const confirm = useConfirm(`disconnect-${tool.id}`);
  const [apiKey, setApiKey] = useState("");
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
            {/* একসাথে একটাই ব্যানার: পাঠানো আটকে থাকাটা আগে */}
            {tool.lastError ? (
              <s-banner tone="critical">
                {t("integrations.lastError", { error: tool.lastError })}
              </s-banner>
            ) : (
              tool.listsError && (
                <s-banner tone="warning">
                  {t("integrations.listsFailed", { error: tool.listsError })}
                </s-banner>
              )
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
              <s-text tone="critical">
                {t("integrations.syncFailed", { error: tool.backfill.error ?? "" })}
              </s-text>
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
                onClick={() =>
                  confirm.ask({
                    heading: t("integrations.confirmDisconnect", { name }),
                    body: t("integrations.confirmDisconnectBody", { name }),
                    action: t("integrations.disconnect"),
                    destructive: true,
                    onConfirm: async () => {
                      await send({ intent: "disconnect", provider: tool.id });
                      forget();
                    },
                  })
                }
              >
                {t("integrations.disconnect")}
              </s-button>
              {confirm.modal}
            </s-stack>
          </s-stack>
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

  // শুধু মার্চেন্টের বদলানো তালিকা; বাকিগুলো সার্ভারে সেভ হওয়া মান দেখায়
  const [edits, setEdits] = useState<Record<string, Config>>({});
  const changed = data.tools.filter(
    (tool) =>
      tool.connected &&
      tool.hasLists &&
      edits[tool.id] !== undefined &&
      JSON.stringify(edits[tool.id]) !== JSON.stringify(tool.config),
  );

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const result = fetcher.data;
    // সেভের পরে পেজের ডেটা নতুন মান নিয়ে আসে, তখন বদল আর "বদল" থাকে না (changed খালি হয়)
    if (result.ok) shopify.toast.show(t("integrations.saved"));
    else shopify.toast.show(result.error, { isError: true });
  }, [fetcher.state, fetcher.data, shopify, t]);

  const send: Send = (payload) =>
    fetcher.submit(JSON.stringify(payload), { method: "POST", encType: "application/json" });
  const saveLists = () =>
    void send({
      intent: "lists",
      configs: Object.fromEntries(changed.map((tool) => [tool.id, edits[tool.id]])),
    });

  return (
    <s-page heading={t("integrations.title")}>
      <FormSaveBar
        id="integration-lists"
        dirty={changed.length > 0}
        saving={busy === "lists:"}
        onSave={saveLists}
        onDiscard={() => setEdits({})}
      />
      <s-section heading={t("integrations.assistants")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("integrations.assistantsHelp")}</s-paragraph>
          <s-stack direction="inline">
            <s-button href="/app/assistants">{t("integrations.assistantsOpen")}</s-button>
          </s-stack>
        </s-stack>
      </s-section>
      <s-section heading={t("integrations.emailTools")}>
        <s-paragraph>{t("integrations.emailToolsHelp")}</s-paragraph>
      </s-section>
      {data.tools.map((tool) => (
        // সংযোগ বদলালে কার্ডের ভেতরের ফর্ম নতুন করে শুরু হয়
        <EmailToolCard
          key={`${tool.id}:${tool.connected}`}
          tool={tool}
          config={edits[tool.id] ?? tool.config}
          setConfig={(config) => setEdits((all) => ({ ...all, [tool.id]: config }))}
          forget={() =>
            setEdits((all) =>
              Object.fromEntries(Object.entries(all).filter(([id]) => id !== tool.id)),
            )
          }
          send={send}
          busy={busy}
        />
      ))}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
