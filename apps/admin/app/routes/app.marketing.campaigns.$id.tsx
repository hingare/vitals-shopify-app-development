import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useNavigate, useRevalidator } from "react-router";
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
import {
  findSegment,
  isSegmentId,
  listSegments,
  segmentSize,
  type SegmentOption,
} from "../lib/segments.server";
import { subscriberCounts } from "../lib/subscribers.server";
import type { GraphqlClient } from "../lib/tools.server";
import { useT } from "../lib/i18n";
import { EmailFields, EmailPreview, TestSend } from "../components/EmailEditor";
import { FormSaveBar, useSaveState } from "../components/FormSaveBar";
import { useConfirm } from "../components/ConfirmModal";

/** Shopify-র সেগমেন্টের তালিকা; আনা না গেলে null (তখনও সব সাবস্ক্রাইবারকে পাঠানো যায়) */
const loadSegments = (admin: GraphqlClient) => listSegments(admin).catch(() => null);

/** বেছে নেওয়া সেগমেন্টে কতজন (শুধু দেখানোর জন্য) */
const sizeOf = (admin: GraphqlClient, segment: SegmentOption | null) =>
  segment ? segmentSize(admin, segment.id) : Promise.resolve(null);

/**
 * সেভ করা সেগমেন্টটা Shopify-তে আর নেই কিনা। তালিকায় না থাকলেই নেই ধরা হয় না (খুব বেশি সেগমেন্ট থাকলে
 * তালিকায় সব আসে না), Shopify-তে আলাদা করে দেখা হয়; জানা না গেলে false, যাতে পাঠানো আটকে না যায়।
 */
async function segmentGone(
  admin: GraphqlClient,
  segment: SegmentOption | null,
  segments: SegmentOption[] | null,
) {
  if (!segment || !segments || segments.some((s) => s.id === segment.id)) return false;
  return (await findSegment(admin, segment.id).catch(() => segment)) === null;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
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
    const segments = await loadSegments(admin);
    // Shopify-র Segments পাতার "Use segment" থেকে এলে (segment-campaign extension) সেগমেন্ট আগে থেকেই বাছা
    const preset = new URL(request.url).searchParams.get("segment");
    const segment = isSegmentId(preset)
      ? (segments?.find((s) => s.id === preset) ??
        (await findSegment(admin, preset).catch(() => null)))
      : null;
    return {
      ...shared,
      id: null,
      name: "",
      status: "draft",
      scheduledAt: null,
      recipients: 0,
      content: { ...DEFAULT_CAMPAIGN, buttonUrl: context.storeUrl },
      stats: null,
      segments,
      segment,
      segmentSize: await sizeOf(admin, segment),
      segmentGone: false,
      error: null,
    };
  }
  const campaign = await getCampaign(shop.id, params.id ?? "");
  if (!campaign) throw new Response("Not found", { status: 404 });
  const editable = campaign.status === "draft" || campaign.status === "scheduled";
  const segment: SegmentOption | null = campaign.segmentId
    ? { id: campaign.segmentId, name: campaign.segmentName ?? "" }
    : null;
  const [segments, stats] = await Promise.all([
    editable ? loadSegments(admin) : null,
    editable ? null : campaignStats(shop.id, campaign.id),
  ]);
  const [size, gone]: [number | null, boolean] = editable
    ? await Promise.all([sizeOf(admin, segment), segmentGone(admin, segment, segments)])
    : [null, false];
  return {
    ...shared,
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
    recipients: campaign.recipients,
    content: readCampaignContent(campaign.content),
    stats,
    segments,
    segment,
    segmentSize: size,
    segmentGone: gone,
    error: campaign.error,
  };
};

type Result = { ok: true; intent: string } | { ok: false; intent: string; error: string };

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as {
    intent?: string;
    name?: string;
    content?: unknown;
    segmentId?: string | null;
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

  // বেছে নেওয়া সেগমেন্টটা এখনো স্টোরে আছে কিনা Shopify-তে দেখে নাম সহ রাখা
  let segment: SegmentOption | null = null;
  if (body.segmentId) {
    try {
      segment = await findSegment(admin, body.segmentId);
    } catch {
      return fail("segments_unavailable");
    }
    if (!segment) return fail("segment_missing");
  }

  let id: string;
  try {
    id = await saveCampaign(shop.id, existing, {
      name: body.name ?? "",
      content: body.content,
      segment,
    });
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

/** এই কাজগুলো পাঠানোর আগে নাম আর লেখা সেভ করে */
const SAVES = new Set(["save", "schedule", "send"]);

export default function CampaignPage() {
  const data = useLoaderData<typeof loader>();
  // নতুন ক্যাম্পেইন প্রথম সেভে নিজের ঠিকানা পায়; তখন সেভ হওয়া অবস্থা থেকে নতুন করে শুরু
  return <CampaignEditor key={data.id ?? "new"} />;
}

function CampaignEditor() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [name, setName] = useState(data.name);
  const [content, setContent] = useState(data.content);
  const [segmentId, setSegmentId] = useState(data.segment?.id ?? "");
  const { dirty, begin, commit, saved } = useSaveState({ name, content, segmentId });
  const confirm = useConfirm("campaign-confirm");
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
      if (SAVES.has(result.intent)) commit();
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
      segment_missing: t("marketing.campaign.segmentGone"),
      segments_unavailable: t("marketing.campaign.segmentsCheckFailed"),
    };
    shopify.toast.show(
      messages[result.error] ?? t("marketing.email.testFailed", { error: result.error }),
      { isError: true },
    );
  }, [fetcher.state, fetcher.data, shopify, t, commit]);

  const submit = (payload: { intent: string } & Record<string, unknown>) => {
    if (SAVES.has(payload.intent)) begin();
    return fetcher.submit(
      JSON.stringify({ name, content, segmentId: segmentId || null, ...payload }),
      {
        method: "POST",
        encType: "application/json",
      },
    );
  };
  const discard = () => {
    const last = saved();
    setName(last.name);
    setContent(last.content);
    setSegmentId(last.segmentId);
  };
  const loading = (name: string) => (busy && intent === name ? { loading: true } : {});

  function schedule() {
    const at = new Date(whenInput.current?.value ?? "");
    if (Number.isNaN(at.getTime())) {
      shopify.toast.show(t("marketing.campaign.badTime"), { isError: true });
      return;
    }
    submit({ intent: "schedule", at: at.toISOString() });
  }

  // সেগমেন্টের তালিকা (সেভ করা সেগমেন্ট Shopify-তে আর না থাকলেও বাছাই ঘরে দেখায়)
  const segmentOptions = [...(data.segments ?? [])];
  if (data.segment && !segmentOptions.some((s) => s.id === data.segment?.id)) {
    segmentOptions.push(data.segment);
  }
  const chosen = segmentOptions.find((s) => s.id === segmentId) ?? null;
  // সেভ করা সেগমেন্টটাই শুধু তালিকার বাইরে থাকতে পারে; সেটা Shopify-তে আর না থাকলে পাঠানো যায় না
  const segmentMissing = !!chosen && chosen.id === data.segment?.id && data.segmentGone;
  // সংখ্যাটা শুধু পাতা খোলার সময় বাছা সেগমেন্টের জন্য জানা
  const chosenSize = chosen && chosen.id === data.segment?.id ? data.segmentSize : null;
  // কতজন পেতে পারেন: সেগমেন্টে subscribed যাঁরা, সর্বোচ্চ সব সাবস্ক্রাইবার
  const reach = chosen ? Math.min(data.subscribed, chosenSize ?? data.subscribed) : data.subscribed;

  function send() {
    const overLimit = reach > data.left;
    const parts = [
      chosen ? t("marketing.campaign.segmentConsent") : "",
      overLimit ? t("marketing.campaign.overLimit", { left: data.left, n: reach }) : "",
      t("common.cantUndo"),
    ];
    confirm.ask({
      heading: chosen
        ? t("marketing.campaign.confirmSendSegment", { name: chosen.name })
        : t("marketing.campaign.confirmSend", { n: data.subscribed }),
      body: parts.filter(Boolean).join(" "),
      action: t("marketing.campaign.send"),
      onConfirm: () => submit({ intent: "send" }),
    });
  }

  // আগের পাঠানো থেমে গেলে কেন
  const stopped: Record<string, string> = {
    segment_missing: t("marketing.campaign.stopped.segmentMissing"),
    segment_timeout: t("marketing.campaign.stopped.segmentTimeout"),
    send_failed: t("marketing.campaign.stopped.sendFailed"),
  };
  const stopNote = !data.error
    ? null
    : editable
      ? (stopped[data.error] ?? stopped.send_failed)
      : t("marketing.campaign.stopped.partial", { n: data.recipients });

  // একসাথে একটাই ব্যানার: যেটা আগে ঠিক করতে হবে সেটা
  const banner = !data.configured ? (
    <s-banner tone="critical">{t("marketing.notConfigured")}</s-banner>
  ) : data.allowed && !data.toolEnabled ? (
    <s-banner tone="warning">
      {t("marketing.toolOff")}{" "}
      <s-link href="/app/tools/email-marketing">{t("marketing.toolOff.action")}</s-link>
    </s-banner>
  ) : stopNote ? (
    <s-banner tone="warning">{stopNote}</s-banner>
  ) : !editable ? (
    <s-banner tone="info">{t("marketing.campaign.sentNote")}</s-banner>
  ) : null;

  const stats = data.stats;
  return (
    <s-page heading={data.id ? data.name : t("marketing.newCampaign")}>
      <s-link slot="breadcrumb-actions" href="/app/marketing">
        {t("marketing.back")}
      </s-link>
      {/* নতুন ক্যাম্পেইন এখনো সেভ হয়নি, তাই শুরু থেকেই সেভ বার */}
      <FormSaveBar
        id="campaign-editor"
        dirty={editable && (!data.id || dirty)}
        saving={busy && intent === "save"}
        onSave={() => void submit({ intent: "save" })}
        onDiscard={data.id ? discard : () => navigate("/app/marketing")}
      />
      {editable && data.id && (
        <s-button
          slot="secondary-actions"
          tone="critical"
          onClick={() =>
            confirm.ask({
              heading: t("marketing.campaign.confirmDelete"),
              body: t("common.cantUndo"),
              action: t("marketing.campaign.delete"),
              destructive: true,
              onConfirm: () => submit({ intent: "delete" }),
            })
          }
        >
          {t("marketing.campaign.delete")}
        </s-button>
      )}
      {confirm.modal}

      {banner}

      {stats && (
        <s-section heading={t("marketing.campaign.results")}>
          <s-paragraph>
            {t("marketing.campaign.sentTo", {
              audience: data.segment ? data.segment.name : t("marketing.campaign.allSubscribers"),
            })}
          </s-paragraph>
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
        <s-section heading={t("marketing.campaign.audience")}>
          <s-stack direction="block" gap="small">
            <s-select
              label={t("marketing.campaign.sendTo")}
              details={t("marketing.campaign.sendToHelp")}
              value={segmentId}
              onChange={(e) => setSegmentId(e.currentTarget.value)}
            >
              <s-option value="">
                {t("marketing.campaign.audienceAll", { n: data.subscribed.toLocaleString() })}
              </s-option>
              {segmentOptions.map((segment) => (
                <s-option key={segment.id} value={segment.id}>
                  {segment.name}
                </s-option>
              ))}
            </s-select>
            {data.segments === null && (
              <s-text color="subdued">{t("marketing.campaign.segmentsUnavailable")}</s-text>
            )}
            {segmentMissing ? (
              <s-text tone="caution">{t("marketing.campaign.segmentGone")}</s-text>
            ) : (
              chosen && (
                <s-text color="subdued">
                  {chosenSize === null
                    ? t("marketing.campaign.segmentConsent")
                    : `${t("marketing.campaign.segmentSize", { n: chosenSize.toLocaleString() })} ${t("marketing.campaign.segmentConsent")}`}
                </s-text>
              )
            )}
          </s-stack>
        </s-section>
      )}

      {editable && (
        <s-section heading={t("marketing.campaign.send")}>
          <s-stack direction="block" gap="base">
            {data.status === "scheduled" && data.scheduledAt && (
              <s-text>
                {t("marketing.campaign.scheduledFor", {
                  when: new Date(data.scheduledAt).toLocaleString(),
                })}
              </s-text>
            )}
            {data.subscribed === 0 ? (
              <s-text color="subdued">{t("marketing.campaign.noSubscribers")}</s-text>
            ) : (
              reach > data.left && (
                <s-text tone="caution">
                  {t("marketing.campaign.overLimit", { left: data.left, n: reach })}
                </s-text>
              )
            )}
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                onClick={send}
                {...(data.subscribed === 0 || segmentMissing || !data.allowed || !data.toolEnabled
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
