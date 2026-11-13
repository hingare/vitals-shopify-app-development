import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import {
  CampaignError,
  DEFAULT_CAMPAIGN,
  campaignStats,
  deleteCampaign,
  getCampaign,
  readCampaignContent,
  saveCampaign,
  scheduleCampaign,
  sendTestEmail,
  startCampaign,
} from "../lib/campaigns.server";
import { emailContentSchema } from "../lib/email-template";
import { allowTestSend, marketingContext } from "../lib/marketing.server";
import { subscriberCounts } from "../lib/subscribers.server";
import { useT } from "../lib/i18n";
import { EmailFields, EmailPreview, TestSend } from "../components/EmailEditor";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [context, counts] = await Promise.all([marketingContext(shop), subscriberCounts(shop.id)]);
  const shared = {
    look: context.look,
    storeUrl: context.storeUrl,
    configured: context.configured,
    allowed: context.allowed,
    toolEnabled: context.toolEnabled,
    left: Math.max(0, context.cap - context.sent),
    subscribed: counts.subscribed,
  };
  if (params.id === "new") {
    return {
      ...shared,
      id: null,
      name: "",
      status: "draft",
      scheduledAt: null,
      recipients: 0,
      content: { ...DEFAULT_CAMPAIGN, buttonUrl: context.storeUrl },
      stats: null,
    };
  }
  const campaign = await getCampaign(shop.id, params.id ?? "");
  if (!campaign) throw new Response("Not found", { status: 404 });
  const editable = campaign.status === "draft" || campaign.status === "scheduled";
  return {
    ...shared,
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
    recipients: campaign.recipients,
    content: readCampaignContent(campaign.content),
    stats: editable ? null : await campaignStats(shop.id, campaign.id),
  };
};

type Result = { ok: true; intent: string } | { ok: false; intent: string; error: string };

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as {
    intent?: string;
    name?: string;
    content?: unknown;
    to?: string;
    at?: string;
  };
  const intent = body.intent ?? "save";
  const fail = (error: string): Result => ({ ok: false, intent, error });
  const existing = params.id === "new" ? null : (params.id ?? null);

  if (intent === "delete") {
    if (existing) await deleteCampaign(shop.id, existing);
    return redirect("/app/marketing");
  }
  if (intent === "unschedule") {
    if (existing) await scheduleCampaign(shop.id, existing, null).catch(() => undefined);
    return { ok: true, intent } satisfies Result;
  }
  if (!emailContentSchema.safeParse(body.content).success) return fail("invalid");
  if (intent === "test") {
    if (!allowTestSend(shop.id)) return fail("rate_limited");
    const result = await sendTestEmail(shop, body.content, body.to);
    return result.ok
      ? ({ ok: true, intent } satisfies Result)
      : fail(result.error ?? "send_failed");
  }

  let id: string;
  try {
    id = await saveCampaign(shop.id, existing, { name: body.name ?? "", content: body.content });
    if (intent === "schedule") {
      const at = new Date(body.at ?? "");
      // অতীতের সময় বা এক বছরের বেশি পরের সময় নয়
      if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 60_000) return fail("bad_time");
      if (at.getTime() > Date.now() + 366 * 86_400_000) return fail("bad_time");
      await scheduleCampaign(shop.id, id, at);
    }
    if (intent === "send") await startCampaign(shop.id, id);
  } catch (error) {
    if (error instanceof CampaignError) return fail(error.code);
    throw error;
  }
  if (!existing) return redirect(`/app/marketing/campaigns/${id}`);
  return { ok: true, intent } satisfies Result;
};

/** ব্রাউজারের স্থানীয় সময়ে "YYYY-MM-DDTHH:mm" (datetime-local ঘরের জন্য) */
function localInput(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date(Date.now() + 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function CampaignPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [name, setName] = useState(data.name);
  const [content, setContent] = useState(data.content);
  const whenInput = useRef<HTMLInputElement>(null);
  const editable = data.status === "draft" || data.status === "scheduled";
  const busy = fetcher.state !== "idle";
  const intent = (fetcher.json as { intent?: string } | undefined)?.intent;

  // সময়ের ঘর ব্রাউজারের সময় অঞ্চলে ভরা হয় (সার্ভারে নয়), তাই পেজ খোলার পরে মান বসে
  useEffect(() => {
    if (whenInput.current) whenInput.current.value = localInput(data.scheduledAt);
  }, [data.scheduledAt, editable]);

  // পাঠানো চলাকালীন সংখ্যাগুলো কয়েক সেকেন্ড পরপর নতুন করে আনা
  useEffect(() => {
    if (data.status !== "sending" && !(data.stats && data.stats.queued > 0)) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [data.status, data.stats, revalidator]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const result = fetcher.data;
    if (result.ok) {
      const key =
        result.intent === "test"
          ? "marketing.email.testSent"
          : result.intent === "send"
            ? "marketing.campaign.started"
            : "marketing.saved";
      shopify.toast.show(t(key));
      return;
    }
    const messages: Record<string, string> = {
      invalid: t("marketing.email.invalid"),
      rate_limited: t("marketing.email.tooMany"),
      email_not_configured: t("marketing.notConfigured"),
      already_sent: t("marketing.campaign.sentNote"),
      bad_time: t("marketing.campaign.badTime"),
      tool_off: t("marketing.toolOff"),
    };
    shopify.toast.show(
      messages[result.error] ?? t("marketing.email.testFailed", { error: result.error }),
      { isError: true },
    );
  }, [fetcher.state, fetcher.data, shopify, t]);

  const submit = (payload: Record<string, unknown>) =>
    fetcher.submit(JSON.stringify({ name, content, ...payload }), {
      method: "POST",
      encType: "application/json",
    });
  const loading = (name: string) => (busy && intent === name ? { loading: true } : {});

  function schedule() {
    const at = new Date(whenInput.current?.value ?? "");
    if (Number.isNaN(at.getTime())) {
      shopify.toast.show(t("marketing.campaign.badTime"), { isError: true });
      return;
    }
    submit({ intent: "schedule", at: at.toISOString() });
  }

  function send() {
    const message =
      data.subscribed > data.left
        ? `${t("marketing.campaign.overLimit", { left: data.left, n: data.subscribed })}\n\n${t("marketing.campaign.confirmSend", { n: data.subscribed })}`
        : t("marketing.campaign.confirmSend", { n: data.subscribed });
    if (window.confirm(message)) submit({ intent: "send" });
  }

  const stats = data.stats;
  return (
    <s-page heading={data.id ? data.name : t("marketing.newCampaign")}>
      <s-link slot="breadcrumb-actions" href="/app/marketing">
        {t("marketing.back")}
      </s-link>
      {editable && (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={() => submit({ intent: "save" })}
          {...loading("save")}
        >
          {t("marketing.campaign.saveDraft")}
        </s-button>
      )}
      {editable && data.id && (
        <s-button
          slot="secondary-actions"
          tone="critical"
          onClick={() => {
            if (window.confirm(t("marketing.campaign.confirmDelete"))) submit({ intent: "delete" });
          }}
        >
          {t("marketing.campaign.delete")}
        </s-button>
      )}

      {data.allowed && !data.toolEnabled && (
        <s-banner tone="warning">
          {t("marketing.toolOff")}{" "}
          <s-link href="/app/tools/email-marketing">{t("marketing.toolOff.action")}</s-link>
        </s-banner>
      )}
      {!data.configured && <s-banner tone="critical">{t("marketing.notConfigured")}</s-banner>}
      {!editable && <s-banner tone="info">{t("marketing.campaign.sentNote")}</s-banner>}
      {data.status === "scheduled" && data.scheduledAt && (
        <s-banner tone="info">
          {t("marketing.campaign.scheduledFor", {
            when: new Date(data.scheduledAt).toLocaleString(),
          })}
        </s-banner>
      )}

      {stats && (
        <s-section heading={t("marketing.campaign.results")}>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(130px, 1fr))" gap="base">
            {(
              [
                ["marketing.campaign.recipients", data.recipients],
                ["marketing.campaign.delivered", stats.rate === null ? "–" : `${stats.rate}%`],
                ["marketing.campaign.opened", stats.opened],
                ["marketing.campaign.clicked", stats.clicked],
                ["marketing.campaign.skipped", stats.skipped],
                ["marketing.campaign.queued", stats.queued],
              ] as const
            ).map(([label, value]) => (
              <s-stack key={label} direction="block" gap="small-100">
                <s-text color="subdued">{t(label)}</s-text>
                <s-heading>{typeof value === "number" ? value.toLocaleString() : value}</s-heading>
              </s-stack>
            ))}
          </s-grid>
        </s-section>
      )}

      <s-section>
        <s-stack direction="block" gap="base">
          <s-text-field
            label={t("marketing.campaign.name")}
            details={t("marketing.campaign.nameHelp")}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            {...(editable ? {} : { disabled: true })}
          />
          <EmailFields
            content={content}
            onChange={(next) => setContent({ ...content, ...next })}
            withLinks
            vars="{first_name}, {shop}"
            disabled={!editable}
          />
        </s-stack>
      </s-section>

      {editable && (
        <s-section heading={t("marketing.campaign.send")}>
          <s-stack direction="block" gap="base">
            {data.subscribed === 0 ? (
              <s-text color="subdued">{t("marketing.campaign.noSubscribers")}</s-text>
            ) : (
              data.subscribed > data.left && (
                <s-banner tone="warning">
                  {t("marketing.campaign.overLimit", { left: data.left, n: data.subscribed })}
                </s-banner>
              )
            )}
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                onClick={send}
                {...(data.subscribed === 0 || !data.allowed || !data.toolEnabled
                  ? { disabled: true }
                  : {})}
                {...loading("send")}
              >
                {t("marketing.campaign.send")}
              </s-button>
            </s-stack>
            <s-divider />
            <s-stack direction="inline" gap="small" alignItems="end">
              <label>
                <span style={{ display: "block", fontSize: "13px", marginBottom: "4px" }}>
                  {t("marketing.campaign.scheduleAt")}
                </span>
                <input
                  ref={whenInput}
                  type="datetime-local"
                  style={{ font: "inherit", padding: "6px 8px", minHeight: "32px" }}
                />
              </label>
              <s-button
                onClick={schedule}
                {...(data.allowed && data.toolEnabled ? {} : { disabled: true })}
                {...loading("schedule")}
              >
                {t("marketing.campaign.schedule")}
              </s-button>
              {data.status === "scheduled" && (
                <s-button
                  onClick={() => submit({ intent: "unschedule" })}
                  {...loading("unschedule")}
                >
                  {t("marketing.campaign.unschedule")}
                </s-button>
              )}
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {editable && (
        <s-section heading={t("marketing.email.sendTest")}>
          <TestSend
            sending={busy && intent === "test"}
            onSend={(to) => submit({ intent: "test", to })}
          />
        </s-section>
      )}

      <s-section slot="aside" heading={t("marketing.email.preview")}>
        <EmailPreview content={content} look={data.look} fallbackUrl="" />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
