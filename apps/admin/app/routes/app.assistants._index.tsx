import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { brand } from "@app/brand";

import { authenticate } from "../shopify.server";
import { ensureShop, planOf } from "../lib/shop.server";
import {
  createAccessKey,
  disconnect,
  ensureMcpId,
  listConnections,
  mcpServerUrl,
} from "../lib/mcp/oauth.server";
import {
  decideAction,
  pendingActions,
  recentActions,
  type ActionView,
} from "../lib/mcp/actions.server";
import { describeAction, type ActionStatus } from "../lib/mcp/describe";
import { CopyButton } from "../components/CopyButton";
import { ago, minutesSince } from "../lib/ago";
import { useT } from "../lib/i18n";

/**
 * AI সহকারী (MCP): স্টোরের ঠিকানা, কীভাবে যুক্ত করবেন, সহকারীর চাওয়া পরিবর্তনের অনুমোদন,
 * যুক্ত সহকারী আর চাবি। সহকারী নিজে কিছু বদলায় না; এখানে "অনুমোদন" চাপলে তবেই হয়।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const focus = new URL(request.url).searchParams.get("action");
  if (planOf(shop) !== "professional") {
    return { professional: false as const };
  }
  const mcpId = await ensureMcpId(shop);
  const [pending, recent, connections] = await Promise.all([
    pendingActions(shop.id),
    recentActions(shop.id, { take: 30 }),
    listConnections(shop.id),
  ]);
  return {
    professional: true as const,
    mcpUrl: mcpServerUrl(mcpId),
    pending,
    recent: recent.filter((row) => row.status !== "pending").slice(0, 20),
    connections,
    focus,
    focusDone: Boolean(focus) && !pending.some((row) => row.id === focus),
    now: new Date().toISOString(),
  };
};

type Result =
  | { ok: true; intent: string; status?: string; key?: string }
  | { ok: false; intent: string; error: string; message?: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as Record<string, unknown>;
  const intent = String(body.intent ?? "");
  const id = String(body.id ?? "");
  if (planOf(shop) !== "professional") {
    return { ok: false, intent, error: "plan" } satisfies Result;
  }
  if (intent === "approve" || intent === "reject") {
    const result = await decideAction(admin, shop, id, intent === "approve");
    return result.ok
      ? ({ ok: true, intent, status: result.status } satisfies Result)
      : ({ ok: false, intent, error: result.error, message: result.message } satisfies Result);
  }
  if (intent === "disconnect") {
    await disconnect(shop.id, id);
    return { ok: true, intent } satisfies Result;
  }
  if (intent === "createKey") {
    const created = await createAccessKey(shop.id, {
      name: String(body.name ?? ""),
      write: body.write === true,
    });
    return created.ok
      ? ({ ok: true, intent, key: created.key } satisfies Result)
      : ({ ok: false, intent, error: created.error } satisfies Result);
  }
  return { ok: false, intent, error: "unknown" } satisfies Result;
};

const GUIDES = ["chatgpt", "claude", "gemini", "grok", "other"] as const;
type Guide = (typeof GUIDES)[number];

const STATUS_TONE: Record<ActionStatus, "info" | "success" | "critical" | "warning" | undefined> = {
  pending: "info",
  running: "info",
  done: "success",
  failed: "critical",
  rejected: undefined,
  expired: "warning",
};

type Send = (payload: Record<string, unknown>) => void;

function PendingRequest({
  row,
  focused,
  now,
  send,
  busy,
}: {
  row: ActionView;
  focused: boolean;
  now: Date;
  send: Send;
  busy: string | null;
}) {
  const t = useT();
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text type="strong">{describeAction(row.tool, row.input, row.details, t)}</s-text>
          {focused && <s-badge tone="info">{t("assistants.fromLink")}</s-badge>}
        </s-stack>
        <s-text color="subdued">
          {t("assistants.askedBy", {
            name: row.assistant,
            when: ago(t, minutesSince(row.createdAt, now)),
          })}
        </s-text>
        <s-stack direction="inline" gap="small">
          <s-button
            variant="primary"
            onClick={() => send({ intent: "approve", id: row.id })}
            {...(busy === `approve:${row.id}` ? { loading: true } : {})}
            {...(busy && busy !== `approve:${row.id}` ? { disabled: true } : {})}
          >
            {t("assistants.approve")}
          </s-button>
          <s-button
            onClick={() => send({ intent: "reject", id: row.id })}
            {...(busy ? { disabled: true } : {})}
          >
            {t("assistants.reject")}
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function ConnectGuide({ url }: { url: string }) {
  const t = useT();
  const [guide, setGuide] = useState<Guide>("chatgpt");
  const vars = { url, name: brand.slug };
  return (
    <s-section heading={t("assistants.how")}>
      <s-stack direction="block" gap="base">
        <s-select
          label={t("assistants.howPick")}
          value={guide}
          onChange={(e) => setGuide(e.currentTarget.value as Guide)}
        >
          {GUIDES.map((id) => (
            <s-option key={id} value={id}>
              {t(`assistants.guide.${id}`)}
            </s-option>
          ))}
        </s-select>
        <s-ordered-list>
          {[1, 2, 3].map((step) => (
            <s-list-item key={step}>{t(`assistants.guide.${guide}.${step}`, vars)}</s-list-item>
          ))}
        </s-ordered-list>
      </s-stack>
    </s-section>
  );
}

/** নিজের fetcher: নতুন চাবিটা পাতার অন্য কাজের পরেও দেখা যায়, যতক্ষণ না আরেকটা বানানো হয় */
function AccessKeys() {
  const t = useT();
  const fetcher = useFetcher<typeof action>();
  const [name, setName] = useState("");
  const [write, setWrite] = useState(false);
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  const created = result?.ok && result.intent === "createKey" ? (result.key ?? null) : null;
  const problem = result && !result.ok ? result.error : null;
  const create = () =>
    fetcher.submit(JSON.stringify({ intent: "createKey", name, write }), {
      method: "POST",
      encType: "application/json",
    });
  return (
    <s-section heading={t("assistants.keys")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("assistants.keysHelp")}</s-paragraph>
        {created && (
          <s-banner tone="success">
            <s-stack direction="block" gap="small">
              <s-text>{t("assistants.keyCreated")}</s-text>
              <s-text-field
                label={t("assistants.keys")}
                labelAccessibilityVisibility="exclusive"
                value={created}
                readOnly
              />
              <s-stack direction="inline">
                <CopyButton text={created} variant="secondary" />
              </s-stack>
            </s-stack>
          </s-banner>
        )}
        {problem && (
          <s-banner tone="critical">
            {problem === "too_many"
              ? t("assistants.keyTooMany")
              : problem === "plan"
                ? t("assistants.needsPro")
                : t("assistants.error.unknown")}
          </s-banner>
        )}
        <s-text-field
          label={t("assistants.keyName")}
          details={t("assistants.keyNameHelp")}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <s-checkbox
          label={t("assistants.keyWrite")}
          checked={write}
          onChange={(e) => setWrite(e.currentTarget.checked)}
        />
        <s-stack direction="inline">
          <s-button onClick={create} {...(fetcher.state !== "idle" ? { loading: true } : {})}>
            {t("assistants.createKey")}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export default function AssistantsPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const submitted = fetcher.json as { intent?: string; id?: string } | undefined;
  const busy =
    fetcher.state !== "idle" && submitted ? `${submitted.intent}:${submitted.id ?? ""}` : null;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const result = fetcher.data;
    if (result.ok) {
      if (result.intent === "approve") shopify.toast.show(t("assistants.approved"));
      else if (result.intent === "reject") shopify.toast.show(t("assistants.rejected"));
      else if (result.intent === "disconnect") shopify.toast.show(t("assistants.disconnected"));
      return;
    }
    const message =
      result.error === "plan"
        ? t("assistants.needsPro")
        : t(`assistants.error.${result.error}`, { message: result.message ?? "" });
    shopify.toast.show(message, { isError: true });
  }, [fetcher.state, fetcher.data, shopify, t]);

  const send: Send = (payload) =>
    fetcher.submit(JSON.stringify(payload), { method: "POST", encType: "application/json" });

  if (!data.professional) {
    return (
      <s-page heading={t("assistants.title")}>
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("assistants.intro")}</s-paragraph>
            <s-banner tone="info">
              <s-stack direction="block" gap="small">
                <s-text>{t("assistants.needsPro")}</s-text>
                <s-link href="/app/plans">{t("assistants.upgrade")}</s-link>
              </s-stack>
            </s-banner>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const now = new Date(data.now);
  // লিংক থেকে আসা অনুরোধ সবার আগে
  const pending = [...data.pending].sort(
    (a, b) => Number(b.id === data.focus) - Number(a.id === data.focus),
  );

  return (
    <s-page heading={t("assistants.title")}>
      <s-section>
        <s-paragraph>{t("assistants.intro")}</s-paragraph>
      </s-section>

      {data.focusDone && (
        <s-section>
          <s-banner tone="info">{t("assistants.focusDone")}</s-banner>
        </s-section>
      )}

      {pending.length > 0 && (
        <s-section heading={t("assistants.pending")}>
          <s-stack direction="block" gap="base">
            <s-text color="subdued">{t("assistants.pendingHelp")}</s-text>
            {pending.map((row) => (
              <PendingRequest
                key={row.id}
                row={row}
                focused={row.id === data.focus}
                now={now}
                send={send}
                busy={busy}
              />
            ))}
          </s-stack>
        </s-section>
      )}

      <s-section heading={t("assistants.address")}>
        <s-stack direction="block" gap="small">
          <s-text-field
            label={t("assistants.address")}
            labelAccessibilityVisibility="exclusive"
            value={data.mcpUrl}
            readOnly
          />
          <s-stack direction="inline" gap="small" alignItems="center">
            <CopyButton text={data.mcpUrl} variant="secondary" />
            <s-text color="subdued">{t("assistants.addressHelp")}</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <ConnectGuide url={data.mcpUrl} />

      <s-section heading={t("assistants.connected")}>
        {data.connections.length === 0 ? (
          <s-paragraph>{t("assistants.connectedEmpty")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("assistants.col.name")}</s-table-header>
              <s-table-header>{t("assistants.col.access")}</s-table-header>
              <s-table-header>{t("assistants.col.lastUsed")}</s-table-header>
              <s-table-header />
            </s-table-header-row>
            <s-table-body>
              {data.connections.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-200">
                      <s-text type="strong">{row.name}</s-text>
                      <s-text color="subdued">
                        {row.kind === "key"
                          ? t("assistants.kind.key", { hint: row.keyHint ?? "" })
                          : row.verifiedHost
                            ? t("assistants.verified", { host: row.verifiedHost })
                            : t("assistants.kind.oauth")}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {t(row.write ? "assistants.access.write" : "assistants.access.read")}
                  </s-table-cell>
                  <s-table-cell>
                    {row.lastUsedAt
                      ? ago(t, minutesSince(row.lastUsedAt, now))
                      : t("assistants.never")}
                  </s-table-cell>
                  <s-table-cell>
                    <s-button
                      tone="critical"
                      variant="tertiary"
                      onClick={() => {
                        if (window.confirm(t("assistants.confirmDisconnect", { name: row.name }))) {
                          send({ intent: "disconnect", id: row.id });
                        }
                      }}
                      {...(busy === `disconnect:${row.id}` ? { loading: true } : {})}
                    >
                      {t("assistants.disconnect")}
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <AccessKeys />

      <s-section heading={t("assistants.recent")}>
        {data.recent.length === 0 ? (
          <s-paragraph>{t("assistants.recentEmpty")}</s-paragraph>
        ) : (
          <s-stack direction="block" gap="small">
            {data.recent.map((row) => (
              <s-stack key={row.id} direction="inline" gap="small" alignItems="center">
                <s-badge {...(STATUS_TONE[row.status] ? { tone: STATUS_TONE[row.status] } : {})}>
                  {t(`assistants.status.${row.status}`)}
                </s-badge>
                <s-text>{describeAction(row.tool, row.input, row.details, t)}</s-text>
                <s-text color="subdued">
                  {t("assistants.askedBy", {
                    name: row.assistant,
                    when: ago(t, minutesSince(row.createdAt, now)),
                  })}
                </s-text>
                {row.error && <s-text tone="caution">{row.error}</s-text>}
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
