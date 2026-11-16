import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import {
  createTicket,
  isDeskShop,
  listTickets,
  shopOwnerEmail,
  supportInbox,
  typicalReplyMinutes,
} from "../lib/support.server";
import { assistantEnabled, helpCenterUrl, siteUrl } from "../lib/support-ai.server";
import {
  ASK_TURNS,
  MESSAGE_MAX,
  QUESTION_MAX,
  SUBJECT_MAX,
  answerLines,
  replyTimeLabel,
  type AskError,
  type AskMessage,
  type AskResult,
} from "../lib/support";
import { ago, minutesSince } from "../lib/ago";
import { useT } from "../lib/i18n";
import { StatusBadge } from "../components/SupportStatus";

/**
 * অ্যাপের Help পাতা: সাহায্য কেন্দ্র থেকে তাৎক্ষণিক উত্তর (সহকারী, app.help.ask), সাপোর্টে লেখা (টিকিট),
 * আর নিজের অনুরোধ ও তার উত্তর। টিকিটের উত্তর আসে অ্যাপের মালিকের সাপোর্ট ডেস্ক থেকে (app.desk.*)।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const now = new Date();
  const [tickets, replyMinutes, email] = await Promise.all([
    listTickets(shop.id),
    typicalReplyMinutes(now),
    shopOwnerEmail(admin),
  ]);
  const newest = tickets.reduce<(typeof tickets)[number] | null>(
    (best, ticket) => (!best || ticket.createdAt > best.createdAt ? ticket : best),
    null,
  );
  return {
    assistant: assistantEnabled(),
    site: siteUrl(),
    helpCenter: helpCenterUrl(),
    inbox: supportInbox(),
    email,
    replyMinutes,
    desk: isDeskShop(session.shop),
    /** নতুন টিকিট পাঠানো হলে বদলায়, তাতে ফর্মটা খালি হয়ে নতুন করে বসে */
    newestTicket: newest?.id ?? null,
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      unread: ticket.unread,
      minutes: minutesSince(ticket.lastMessageAt, now),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  return createTicket(shop.id, { email: body?.email, subject: body?.subject, body: body?.body });
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

/** সহকারীর উত্তর: সাধারণ লেখা, **বোল্ড** আর সাহায্য কেন্দ্রের লিংক (নতুন ট্যাবে) */
function Answer({ text, site }: { text: string; site: string }) {
  return (
    <s-stack direction="block" gap="small-200">
      {answerLines(text, site).map((parts, line) => (
        <s-paragraph key={line}>
          {parts.map((part, index) =>
            part.kind === "link" ? (
              <s-link key={index} href={part.href} target="_blank">
                {part.text}
              </s-link>
            ) : part.kind === "bold" ? (
              <s-text key={index} type="strong">
                {part.text}
              </s-text>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </s-paragraph>
      ))}
    </s-stack>
  );
}

function Assistant({ site, onContact }: { site: string; onContact: (question: string) => void }) {
  const t = useT();
  const [turns, setTurns] = useState<AskMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<AskError | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    const text = question.trim();
    if (!text || busy) return;
    const next: AskMessage[] = [...turns, { role: "user", content: text }];
    // প্রশ্ন দিয়ে শুরু আর শেষ হতে হয়, তাই লম্বা কথোপকথনের শেষ বিজোড় সংখ্যক বার্তা যায়
    const history = next.length > ASK_TURNS ? next.slice(-(ASK_TURNS - 1)) : next;
    setTurns(next);
    setQuestion("");
    setError(null);
    setBusy(true);
    let result: AskResult;
    try {
      // App Bridge নিজেই Shopify-র session token যোগ করে
      const res = await fetch("/app/help/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      result = (await res.json()) as AskResult;
    } catch {
      result = { ok: false, error: "failed" };
    }
    if (result.ok) {
      setTurns([...next, { role: "assistant", content: result.answer }]);
    } else {
      // প্রশ্নটা লেখার ঘরে ফিরে যায়, যাতে আবার পাঠানো যায়
      setTurns(turns);
      setQuestion(text);
      setError(result.error);
    }
    setBusy(false);
  };

  const lastQuestion = [...turns].reverse().find((turn) => turn.role === "user")?.content ?? "";
  const answered = turns.some((turn) => turn.role === "assistant");

  return (
    <s-section heading={t("helpPage.ask.title")}>
      <s-stack direction="block" gap="base">
        <s-paragraph>{t("helpPage.ask.intro")}</s-paragraph>
        {turns.map((turn, index) => (
          <s-box
            key={index}
            padding="small"
            borderRadius="base"
            background={turn.role === "user" ? "subdued" : "base"}
            border={turn.role === "user" ? "none" : "base"}
          >
            <s-stack direction="block" gap="small-300">
              <s-text type="strong">
                {turn.role === "user" ? t("helpPage.ask.you") : t("helpPage.ask.assistant")}
              </s-text>
              {turn.role === "user" ? (
                <s-paragraph>{turn.content}</s-paragraph>
              ) : (
                <Answer text={turn.content} site={site} />
              )}
            </s-stack>
          </s-box>
        ))}
        {busy && (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-spinner accessibilityLabel={t("helpPage.ask.thinking")} />
            <s-text color="subdued">{t("helpPage.ask.thinking")}</s-text>
          </s-stack>
        )}
        {error && <s-text tone="critical">{t(`helpPage.ask.error.${error}`)}</s-text>}
        <s-text-area
          label={t("helpPage.ask.label")}
          placeholder={t("helpPage.ask.placeholder")}
          rows={2}
          maxLength={QUESTION_MAX}
          value={question}
          onInput={(event) => setQuestion(event.currentTarget.value)}
        />
        <s-stack direction="inline" gap="small-200">
          <s-button
            variant="primary"
            onClick={() => void ask()}
            loading={busy}
            disabled={!question.trim()}
          >
            {t("helpPage.ask.send")}
          </s-button>
          {turns.length > 0 && !busy && (
            <s-button
              onClick={() => {
                setTurns([]);
                setError(null);
              }}
            >
              {t("helpPage.ask.clear")}
            </s-button>
          )}
        </s-stack>
        {answered && !busy && (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text>{t("helpPage.ask.notSolved")}</s-text>
            <s-button variant="tertiary" onClick={() => onContact(lastQuestion)}>
              {t("helpPage.ask.contact")}
            </s-button>
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

const FIELD_ERRORS: Partial<Record<string, "email" | "subject" | "body">> = {
  invalid_email: "email",
  invalid_subject: "subject",
  invalid_body: "body",
};

/**
 * Contact support ফর্ম। পাঠানো সফল হলে loader-এর নতুন টিকিটের id বদলায় আর ফর্মটা খালি হয়ে নতুন করে
 * বসে (key দিয়ে); ব্যর্থ হলে লেখা থেকে যায় আর ভুলটা ঘরের নিচে দেখায়।
 */
function ContactForm({
  data,
  prefill,
  fetcher,
}: {
  data: Data;
  prefill: string;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
}) {
  const t = useT();
  const [email, setEmail] = useState(data.email);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(prefill);
  const busy = fetcher.state !== "idle";
  const error = !busy && fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;
  const field = error ? FIELD_ERRORS[error] : undefined;

  const send = () => {
    if (busy) return;
    void fetcher.submit(JSON.stringify({ email, subject, body }), {
      method: "POST",
      encType: "application/json",
    });
  };

  return (
    <s-section heading={t("helpPage.contact.title")} id="contact">
      <s-stack direction="block" gap="base">
        <s-paragraph>
          {t("helpPage.contact.intro", { time: replyTimeLabel(t, data.replyMinutes) })}
        </s-paragraph>
        <s-email-field
          label={t("helpPage.contact.email")}
          value={email}
          error={field === "email" ? t("helpPage.contact.error.invalid_email") : undefined}
          onInput={(event) => setEmail(event.currentTarget.value)}
        />
        <s-text-field
          label={t("helpPage.contact.subject")}
          maxLength={SUBJECT_MAX}
          value={subject}
          error={
            field === "subject"
              ? t("helpPage.contact.error.invalid_subject", { max: SUBJECT_MAX })
              : undefined
          }
          onInput={(event) => setSubject(event.currentTarget.value)}
        />
        <s-text-area
          label={t("helpPage.contact.body")}
          details={t("helpPage.contact.bodyHelp")}
          rows={5}
          maxLength={MESSAGE_MAX}
          value={body}
          error={
            field === "body"
              ? t("helpPage.contact.error.invalid_body", { max: MESSAGE_MAX })
              : undefined
          }
          onInput={(event) => setBody(event.currentTarget.value)}
        />
        {error && !field && (
          <s-text tone="critical">
            {t(
              error === "too_many_open" || error === "too_many_today"
                ? `helpPage.contact.error.${error}`
                : "helpPage.contact.error.other",
            )}
          </s-text>
        )}
        <s-stack direction="inline" gap="small-200">
          <s-button
            variant="primary"
            onClick={send}
            loading={busy}
            disabled={!email.trim() || !subject.trim() || !body.trim()}
          >
            {t("helpPage.contact.send")}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export default function HelpPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const contact = useFetcher<typeof action>();
  const [prefill, setPrefill] = useState({ text: "", at: 0 });
  const unread = data.tickets.find((ticket) => ticket.unread);

  useEffect(() => {
    if (contact.state === "idle" && contact.data?.ok) {
      shopify.toast.show(t("helpPage.contact.sent"));
    }
  }, [contact.state, contact.data, shopify, t]);

  // সহকারীর "Contact support": প্রশ্নটা বার্তায় বসিয়ে ফর্মটা সামনে আনা
  const contactWith = (text: string) => {
    setPrefill({ text, at: Date.now() });
    requestAnimationFrame(() =>
      document.getElementById("contact")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  return (
    <s-page heading={t("helpPage.title")}>
      {data.desk && (
        <s-button slot="secondary-actions" href="/app/desk">
          {t("helpPage.desk")}
        </s-button>
      )}
      {unread && (
        <s-banner tone="info">
          {t("helpPage.newReply", { subject: unread.subject })}{" "}
          <s-link href={`/app/help/${unread.id}`}>{t("helpPage.newReplyOpen")}</s-link>
        </s-banner>
      )}

      {data.assistant && <Assistant site={data.site} onContact={contactWith} />}

      <ContactForm
        key={`${data.newestTicket ?? "none"}:${prefill.at}`}
        data={data}
        prefill={prefill.text}
        fetcher={contact}
      />

      <s-section heading={t("helpPage.tickets.title")}>
        {data.tickets.length === 0 ? (
          <s-paragraph>{t("helpPage.tickets.empty")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("helpPage.tickets.subject")}</s-table-header>
              <s-table-header>{t("helpPage.tickets.status")}</s-table-header>
              <s-table-header>{t("helpPage.tickets.updated")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.tickets.map((ticket) => (
                <s-table-row key={ticket.id}>
                  <s-table-cell>
                    <s-link href={`/app/help/${ticket.id}`}>{ticket.subject}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <StatusBadge status={ticket.status} unread={ticket.unread} />
                  </s-table-cell>
                  <s-table-cell>{ago(t, ticket.minutes)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {(data.helpCenter || data.inbox) && (
        <s-section heading={t("helpPage.more.title")}>
          <s-stack direction="block" gap="small-200">
            {data.helpCenter && (
              <s-link href={data.helpCenter} target="_blank">
                {t("helpPage.more.helpCenter")}
              </s-link>
            )}
            {data.inbox && (
              <s-link href={`mailto:${data.inbox}`} target="_blank">
                {t("helpPage.more.email", { email: data.inbox })}
              </s-link>
            )}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
