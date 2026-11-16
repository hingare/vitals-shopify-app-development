import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { liveChat } from "@app/tools";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { readEmailSettings } from "../lib/email-template";
import { emailProvider } from "../lib/email-transport.server";
import { enabledSettings } from "../lib/tool-state.server";
import {
  listConversations,
  markPresence,
  merchantReply,
  openConversation,
  setConversationStatus,
  unreadTotal,
  type ChatView,
} from "../lib/chat.server";
import { ago, minutesSince } from "../lib/ago";
import { MESSAGE_MAX } from "../lib/chat";
import { useT } from "../lib/i18n";

/**
 * Live Chat-এর Chat পাতা: ক্রেতাদের কথোপকথন আর উত্তর দেওয়া। পাতা খোলা থাকলে নতুন বার্তা নিজে থেকে আসে,
 * আর মার্চেন্ট ক্রেতাদের কাছে "অনলাইন" দেখান।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const url = new URL(request.url);
  const view: ChatView = url.searchParams.get("view") === "closed" ? "closed" : "open";
  const selected = url.searchParams.get("c");
  const now = new Date();
  const settings = await enabledSettings(shop, liveChat);
  if (settings) await markPresence(shop.id, now);
  const [list, thread, unread] = await Promise.all([
    selected ? null : listConversations(shop.id, view),
    selected ? openConversation(shop.id, selected) : null,
    unreadTotal(shop.id),
  ]);
  return {
    enabled: settings !== null,
    emailReady: emailProvider() !== "none",
    alertsReady: readEmailSettings(shop.emailSettings).replyTo !== "",
    view,
    unread,
    selected,
    list: (list ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      unread: row.unread,
      preview: row.preview,
      mine: row.lastAuthor === "merchant",
      minutes: minutesSince(row.lastMessageAt, now),
    })),
    thread: thread && {
      ...thread.conversation,
      startedMinutes: minutesSince(thread.conversation.createdAt, now),
      messages: thread.messages.map((message) => ({
        ...message,
        minutes: minutesSince(message.at, now),
      })),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as { intent?: string; id?: unknown; text?: unknown };
  if (typeof body.id !== "string") return { ok: false as const, error: "invalid" };
  if (body.intent === "reply") {
    const result = await merchantReply(shop.id, body.id, body.text);
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }
  if (body.intent === "close" || body.intent === "reopen") {
    const done = await setConversationStatus(
      shop.id,
      body.id,
      body.intent === "close" ? "closed" : "open",
    );
    return done ? { ok: true as const } : { ok: false as const, error: "not_found" };
  }
  return { ok: false as const, error: "invalid" };
};

type T = ReturnType<typeof useT>;

const shopperName = (t: T, email: string | null, id: string) =>
  email ?? t("chat.anonymous", { id: id.slice(-4).toUpperCase() });

/** উত্তর লেখার ঘর। পাঠানো সফল হলে নতুন উত্তরের id বদলায় আর ঘরটা নতুন করে (খালি) বসে; না হলে লেখা থেকে যায় */
function ReplyBox({ id, closed }: { id: string; closed: boolean }) {
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [text, setText] = useState("");
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.ok) {
      shopify.toast.show(t("chat.sendFailed"), { isError: true });
    }
  }, [fetcher.state, fetcher.data, shopify, t]);

  const send = () => {
    if (!text.trim()) return;
    void fetcher.submit(JSON.stringify({ intent: "reply", id, text }), {
      method: "POST",
      encType: "application/json",
    });
  };

  return (
    <s-stack direction="block" gap="small-200">
      <s-text-area
        label={t("chat.reply")}
        rows={3}
        maxLength={MESSAGE_MAX}
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
        details={closed ? t("chat.replyReopens") : undefined}
      />
      <s-stack direction="inline" gap="small-200">
        <s-button variant="primary" onClick={send} loading={busy} disabled={!text.trim()}>
          {t("chat.send")}
        </s-button>
      </s-stack>
    </s-stack>
  );
}

function Thread({
  thread,
}: {
  thread: NonNullable<ReturnType<typeof useLoaderData<typeof loader>>["thread"]>;
}) {
  const t = useT();
  const fetcher = useFetcher<typeof action>();
  const closed = thread.status === "closed";
  const who = shopperName(t, thread.email, thread.id);
  const lastMine = [...thread.messages].reverse().find((message) => message.from === "store");
  const toggle = () =>
    void fetcher.submit(JSON.stringify({ intent: closed ? "reopen" : "close", id: thread.id }), {
      method: "POST",
      encType: "application/json",
    });

  return (
    <s-page heading={who}>
      <s-link slot="breadcrumb-actions" href="/app/chat">
        {t("chat.title")}
      </s-link>
      <s-button slot="secondary-actions" onClick={toggle} loading={fetcher.state !== "idle"}>
        {closed ? t("chat.reopen") : t("chat.close")}
      </s-button>

      <s-section>
        <s-stack direction="block" gap="small-200">
          {closed && <s-badge>{t("chat.closedBadge")}</s-badge>}
          <s-text>
            {thread.email ? t("chat.emailLeft", { email: thread.email }) : t("chat.noEmailLeft")}
          </s-text>
          {thread.customerId && (
            <s-link href={`shopify://admin/customers/${thread.customerId}`} target="_top">
              {t("chat.customer")}
            </s-link>
          )}
          {thread.pagePath && (
            <s-text color="subdued">{t("chat.page", { page: thread.pagePath })}</s-text>
          )}
          <s-text color="subdued">
            {t("chat.started", { when: ago(t, thread.startedMinutes) })}
          </s-text>
        </s-stack>
      </s-section>

      <s-section>
        <s-stack direction="block" gap="base">
          {thread.messages.map((message) => (
            <s-box
              key={message.id}
              padding="small"
              borderRadius="base"
              background={message.from === "store" ? "base" : "subdued"}
              border={message.from === "store" ? "base" : "none"}
            >
              <s-stack direction="block" gap="small-300">
                <s-stack direction="inline" gap="small" justifyContent="space-between">
                  <s-text type="strong">{message.from === "store" ? t("chat.you") : who}</s-text>
                  <s-text color="subdued">{ago(t, message.minutes)}</s-text>
                </s-stack>
                {message.body.split(/\n+/).map((line, index) => (
                  <s-paragraph key={index}>{line}</s-paragraph>
                ))}
              </s-stack>
            </s-box>
          ))}
          <ReplyBox key={lastMine?.id ?? "none"} id={thread.id} closed={closed} />
        </s-stack>
      </s-section>
    </s-page>
  );
}

export default function ChatPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const revalidator = useRevalidator();
  const inThread = data.thread !== null;

  // পাতা খোলা আর সামনে থাকলে নতুন বার্তা নিজে থেকে আসে; এতেই মার্চেন্ট "অনলাইন" থাকেন
  useEffect(() => {
    if (!data.enabled) return;
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible" && revalidator.state === "idle") {
          void revalidator.revalidate();
        }
      },
      inThread ? 4_000 : 10_000,
    );
    return () => clearInterval(timer);
  }, [data.enabled, inThread, revalidator]);

  const banners = (
    <>
      {!data.enabled && (
        <s-banner tone="warning">
          {t("chat.off")} <s-link href="/app/tools/live-chat">{t("chat.turnOn")}</s-link>
        </s-banner>
      )}
      {data.enabled && <s-banner tone="success">{t("chat.online")}</s-banner>}
      {data.enabled && !data.emailReady && <s-banner tone="warning">{t("chat.noEmail")}</s-banner>}
      {data.enabled && data.emailReady && !data.alertsReady && (
        <s-banner tone="info">
          {t("chat.noAlerts")} <s-link href="/app/marketing">{t("chat.addReplyTo")}</s-link>
        </s-banner>
      )}
    </>
  );

  if (data.thread) return <Thread thread={data.thread} />;
  if (data.selected) {
    return (
      <s-page heading={t("chat.title")}>
        <s-link slot="breadcrumb-actions" href="/app/chat">
          {t("chat.title")}
        </s-link>
        <s-banner tone="warning">{t("chat.notFound")}</s-banner>
      </s-page>
    );
  }

  return (
    <s-page heading={t("chat.title")}>
      <s-button slot="secondary-actions" href="/app/tools/live-chat">
        {t("chat.settings")}
      </s-button>
      {banners}
      <s-section>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200">
            <s-button href="/app/chat" variant={data.view === "open" ? "primary" : "secondary"}>
              {data.unread > 0 ? t("chat.openWithCount", { n: data.unread }) : t("chat.openTab")}
            </s-button>
            <s-button
              href="/app/chat?view=closed"
              variant={data.view === "closed" ? "primary" : "secondary"}
            >
              {t("chat.closedTab")}
            </s-button>
          </s-stack>
          {data.list.length === 0 ? (
            <s-paragraph>
              {data.view === "open" ? t("chat.empty") : t("chat.emptyClosed")}
            </s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{t("chat.shopper")}</s-table-header>
                <s-table-header>{t("chat.lastMessage")}</s-table-header>
                <s-table-header>{t("chat.when")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.list.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-link href={`/app/chat?c=${row.id}`}>
                          {shopperName(t, row.email, row.id)}
                        </s-link>
                        {row.unread > 0 && <s-badge tone="warning">{String(row.unread)}</s-badge>}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      {row.mine ? `${t("chat.you")}: ${row.preview}` : row.preview}
                    </s-table-cell>
                    <s-table-cell>{ago(t, row.minutes)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
