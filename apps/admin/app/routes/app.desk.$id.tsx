import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { deskTicket, isDeskShop, setDeskStatus, supportReply } from "../lib/support.server";
import { MESSAGE_MAX, type TicketStatus } from "../lib/support";
import { ago, minutesSince } from "../lib/ago";
import { useT } from "../lib/i18n";
import { StatusBadge } from "../components/SupportStatus";

/** সাপোর্ট ডেস্কে একটা টিকিট: স্টোরের তথ্য, পুরো কথোপকথন, উত্তর, বন্ধ বা আবার খোলা */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isDeskShop(session.shop)) return { allowed: false as const, ticket: null };
  const found = await deskTicket(params.id ?? "");
  if (!found) return { allowed: true as const, ticket: null };
  const now = new Date();
  const { ticket, messages } = found;
  return {
    allowed: true as const,
    ticket: {
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status as TicketStatus,
      email: ticket.email,
      shop: ticket.shop.domain,
      plan: ticket.shop.plan,
      installedMinutes: minutesSince(ticket.shop.installedAt, now),
      uninstalled: ticket.shop.uninstalledAt !== null,
      openedMinutes: minutesSince(ticket.createdAt, now),
      messages: messages.map((message) => ({
        id: message.id,
        fromSupport: message.author === "support",
        body: message.body,
        minutes: minutesSince(message.createdAt, now),
      })),
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isDeskShop(session.shop)) return { intent: null, ok: false as const, error: "not_found" };
  const body = (await request.json().catch(() => null)) as { intent?: unknown; text?: unknown };
  const id = params.id ?? "";
  if (body?.intent === "reply") {
    const result = await supportReply(id, body.text);
    return result.ok
      ? { intent: "reply" as const, ok: true as const }
      : { intent: "reply" as const, ok: false as const, error: result.error };
  }
  if (body?.intent === "close" || body?.intent === "reopen") {
    const done = await setDeskStatus(id, body.intent === "close");
    return { intent: body.intent, ok: done };
  }
  return { intent: null, ok: false as const, error: "invalid" };
};

function ReplyBox() {
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [text, setText] = useState("");
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result || result.intent !== "reply") return;
    if (result.ok) {
      // সফল হলে নতুন বার্তার id বদলায় আর ঘরটা (key দিয়ে) খালি হয়ে নতুন করে বসে
      shopify.toast.show(t("desk.ticket.sent"));
    } else {
      shopify.toast.show(t("desk.ticket.sendFailed"), { isError: true });
    }
  }, [fetcher.state, fetcher.data, shopify, t]);

  const send = () => {
    if (!text.trim() || busy) return;
    void fetcher.submit(JSON.stringify({ intent: "reply", text }), {
      method: "POST",
      encType: "application/json",
    });
  };

  return (
    <s-stack direction="block" gap="small-200">
      <s-text-area
        label={t("desk.ticket.reply")}
        details={t("desk.ticket.replyHelp")}
        rows={6}
        maxLength={MESSAGE_MAX}
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
      />
      <s-stack direction="inline" gap="small-200">
        <s-button variant="primary" onClick={send} loading={busy} disabled={!text.trim()}>
          {t("desk.ticket.send")}
        </s-button>
      </s-stack>
    </s-stack>
  );
}

export default function DeskTicketPage() {
  const { allowed, ticket } = useLoaderData<typeof loader>();
  const t = useT();
  const fetcher = useFetcher<typeof action>();

  if (!allowed || !ticket) {
    return (
      <s-page heading={t("desk.title")}>
        {allowed && (
          <s-link slot="breadcrumb-actions" href="/app/desk">
            {t("desk.title")}
          </s-link>
        )}
        <s-banner tone="warning">{t("desk.ticket.notFound")}</s-banner>
      </s-page>
    );
  }

  const closed = ticket.status === "closed";
  const toggle = () =>
    void fetcher.submit(JSON.stringify({ intent: closed ? "reopen" : "close" }), {
      method: "POST",
      encType: "application/json",
    });

  return (
    <s-page heading={ticket.subject}>
      <s-link slot="breadcrumb-actions" href="/app/desk">
        {t("desk.title")}
      </s-link>
      <s-button slot="secondary-actions" onClick={toggle} loading={fetcher.state !== "idle"}>
        {closed ? t("desk.ticket.reopen") : t("desk.ticket.close")}
      </s-button>

      <s-section>
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <StatusBadge status={ticket.status} />
            <s-text type="strong">{ticket.shop}</s-text>
          </s-stack>
          <s-text>
            {t("desk.ticket.plan", {
              plan: t(ticket.plan ? `plans.${ticket.plan}` : "plans.none"),
            })}
          </s-text>
          <s-text>{t("desk.ticket.email", { email: ticket.email })}</s-text>
          <s-text color="subdued">
            {ticket.uninstalled
              ? t("desk.ticket.uninstalled")
              : t("desk.ticket.installed", { when: ago(t, ticket.installedMinutes) })}
          </s-text>
          <s-text color="subdued">
            {t("desk.ticket.opened", { when: ago(t, ticket.openedMinutes) })}
          </s-text>
        </s-stack>
      </s-section>

      <s-section>
        <s-stack direction="block" gap="base">
          {ticket.messages.map((message) => (
            <s-box
              key={message.id}
              padding="small"
              borderRadius="base"
              background={message.fromSupport ? "base" : "subdued"}
              border={message.fromSupport ? "base" : "none"}
            >
              <s-stack direction="block" gap="small-300">
                <s-stack direction="inline" gap="small" justifyContent="space-between">
                  <s-text type="strong">
                    {message.fromSupport ? t("desk.ticket.support") : t("desk.ticket.merchant")}
                  </s-text>
                  <s-text color="subdued">{ago(t, message.minutes)}</s-text>
                </s-stack>
                {message.body.split(/\n+/).map((line, index) => (
                  <s-paragraph key={index}>{line}</s-paragraph>
                ))}
              </s-stack>
            </s-box>
          ))}
          <ReplyBox key={ticket.messages.at(-1)?.id ?? "none"} />
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
