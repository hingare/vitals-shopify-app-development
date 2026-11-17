import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { brand } from "@app/brand";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { closeTicket, merchantReply, openTicket } from "../lib/support.server";
import { MESSAGE_MAX, type TicketStatus } from "../lib/support";
import { ago, minutesSince } from "../lib/ago";
import { useT } from "../lib/i18n";
import { StatusBadge } from "../components/SupportStatus";

/** মার্চেন্টের একটা সাপোর্ট অনুরোধ: পুরো কথোপকথন, উত্তর লেখা আর "সমাধান হয়েছে" */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const now = new Date();
  const found = await openTicket(shop.id, params.id ?? "", now);
  if (!found) return { ticket: null };
  const { ticket, messages } = found;
  return {
    ticket: {
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status as TicketStatus,
      email: ticket.email,
      openedMinutes: minutesSince(ticket.createdAt, now),
      messages: messages.map((message) => ({
        id: message.id,
        mine: message.author === "merchant",
        body: message.body,
        minutes: minutesSince(message.createdAt, now),
      })),
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json().catch(() => null)) as { intent?: unknown; text?: unknown };
  const id = params.id ?? "";
  if (body?.intent === "reply") {
    const result = await merchantReply(shop.id, id, body.text);
    return result.ok
      ? { intent: "reply" as const, ok: true as const }
      : { intent: "reply" as const, ok: false as const, error: result.error };
  }
  if (body?.intent === "close") {
    const done = await closeTicket(shop.id, id);
    return { intent: "close" as const, ok: done };
  }
  return { intent: null, ok: false as const, error: "invalid" as const };
};

function ReplyBox({ closed }: { closed: boolean }) {
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
      shopify.toast.show(t("helpPage.ticket.sent"));
    } else {
      shopify.toast.show(
        t(result.error === "full" ? "helpPage.ticket.full" : "helpPage.ticket.sendFailed"),
        { isError: true },
      );
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
        label={t("helpPage.ticket.reply")}
        rows={4}
        maxLength={MESSAGE_MAX}
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
        details={closed ? t("helpPage.ticket.replyReopens") : undefined}
      />
      <s-stack direction="inline" gap="small-200">
        <s-button variant="primary" onClick={send} loading={busy} disabled={!text.trim()}>
          {t("helpPage.ticket.send")}
        </s-button>
      </s-stack>
    </s-stack>
  );
}

export default function HelpTicketPage() {
  const { ticket } = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state === "idle" && result?.intent === "close" && result.ok) {
      shopify.toast.show(t("helpPage.ticket.closed"));
    }
  }, [fetcher.state, fetcher.data, shopify, t]);

  if (!ticket) {
    return (
      <s-page heading={t("helpPage.title")}>
        <s-link slot="breadcrumb-actions" href="/app/help">
          {t("helpPage.title")}
        </s-link>
        <s-banner tone="warning">{t("helpPage.ticket.notFound")}</s-banner>
      </s-page>
    );
  }

  const closed = ticket.status === "closed";
  const close = () =>
    void fetcher.submit(JSON.stringify({ intent: "close" }), {
      method: "POST",
      encType: "application/json",
    });

  return (
    <s-page heading={ticket.subject}>
      <s-link slot="breadcrumb-actions" href="/app/help">
        {t("helpPage.title")}
      </s-link>
      {!closed && (
        <s-button slot="secondary-actions" onClick={close} loading={fetcher.state !== "idle"}>
          {t("helpPage.ticket.solved")}
        </s-button>
      )}

      <s-section>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <StatusBadge status={ticket.status} />
          <s-text color="subdued">
            {t("helpPage.ticket.opened", { when: ago(t, ticket.openedMinutes) })}
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
              background={message.mine ? "subdued" : "base"}
              border={message.mine ? "none" : "base"}
            >
              <s-stack direction="block" gap="small-300">
                <s-stack direction="inline" gap="small" justifyContent="space-between">
                  <s-text type="strong">
                    {message.mine
                      ? t("helpPage.ticket.you")
                      : t("helpPage.ticket.support", { brand: brand.name })}
                  </s-text>
                  <s-text color="subdued">{ago(t, message.minutes)}</s-text>
                </s-stack>
                {message.body.split(/\n+/).map((line, index) => (
                  <s-paragraph key={index}>{line}</s-paragraph>
                ))}
              </s-stack>
            </s-box>
          ))}
          <ReplyBox key={ticket.messages.at(-1)?.id ?? "none"} closed={closed} />
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
