import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { deskError, setErrorResolved } from "../lib/errors.server";
import { sourceKey } from "../lib/errors";
import { isDeskShop } from "../lib/support.server";
import { ago, minutesSince } from "../lib/ago";
import { useT } from "../lib/i18n";

/** ত্রুটির খাতায় একটা ত্রুটি: পুরো বার্তা, কোথায় আর কতবার, কোডের কোন লাইন, আর "ঠিক হয়েছে" চিহ্ন */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isDeskShop(session.shop)) return { allowed: false as const, error: null };
  const row = await deskError(params.id ?? "");
  if (!row) return { allowed: true as const, error: null };
  const now = new Date();
  return {
    allowed: true as const,
    error: {
      id: row.id,
      name: row.name,
      message: row.message,
      source: row.source,
      location: row.location,
      stack: row.stack ? row.stack.split("\n") : [],
      count: row.count,
      shop: row.lastShop,
      firstMinutes: minutesSince(row.firstSeenAt, now),
      lastMinutes: minutesSince(row.lastSeenAt, now),
      fixedMinutes: row.resolvedAt ? minutesSince(row.resolvedAt, now) : null,
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isDeskShop(session.shop)) return { intent: null, ok: false };
  const body = (await request.json().catch(() => null)) as { intent?: unknown } | null;
  if (body?.intent !== "resolve" && body?.intent !== "reopen") return { intent: null, ok: false };
  const ok = await setErrorResolved(params.id ?? "", body.intent === "resolve");
  return { intent: body.intent, ok };
};

export default function DeskErrorPage() {
  const { allowed, error } = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result?.ok || !result.intent) return;
    shopify.toast.show(
      t(result.intent === "resolve" ? "deskErrors.detail.resolved" : "deskErrors.detail.reopened"),
    );
  }, [fetcher.state, fetcher.data, shopify, t]);

  if (!allowed || !error) {
    return (
      <s-page heading={t("deskErrors.title")}>
        {allowed && (
          <s-link slot="breadcrumb-actions" href="/app/desk/errors">
            {t("deskErrors.title")}
          </s-link>
        )}
        <s-banner tone="warning">{t("deskErrors.detail.notFound")}</s-banner>
      </s-page>
    );
  }

  const fixed = error.fixedMinutes !== null;
  const toggle = () =>
    void fetcher.submit(JSON.stringify({ intent: fixed ? "reopen" : "resolve" }), {
      method: "POST",
      encType: "application/json",
    });

  return (
    <s-page heading={error.name}>
      <s-link slot="breadcrumb-actions" href="/app/desk/errors">
        {t("deskErrors.title")}
      </s-link>
      <s-button slot="secondary-actions" onClick={toggle} loading={fetcher.state !== "idle"}>
        {fixed ? t("deskErrors.detail.reopen") : t("deskErrors.detail.resolve")}
      </s-button>
      {fixed && (
        <s-banner tone="success">
          {t("deskErrors.detail.fixed", { when: ago(t, error.fixedMinutes ?? 0) })}
        </s-banner>
      )}

      <s-section>
        <s-stack direction="block" gap="small-200">
          <s-paragraph>{error.message}</s-paragraph>
          <s-text>
            {t("deskErrors.detail.where", {
              source: t(sourceKey(error.source)),
              location: error.location,
            })}
          </s-text>
          <s-text>{t("deskErrors.detail.count", { n: error.count })}</s-text>
          <s-text>
            {t("deskErrors.detail.store", { shop: error.shop ?? t("deskErrors.unknownStore") })}
          </s-text>
          <s-text color="subdued">
            {t("deskErrors.detail.firstSeen", { when: ago(t, error.firstMinutes) })}
          </s-text>
          <s-text color="subdued">
            {t("deskErrors.detail.lastSeen", { when: ago(t, error.lastMinutes) })}
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading={t("deskErrors.detail.stack")}>
        {error.stack.length === 0 ? (
          <s-paragraph>{t("deskErrors.detail.noStack")}</s-paragraph>
        ) : (
          <s-box padding="small" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="none">
              {error.stack.map((line, index) => (
                <s-text key={index}>{line}</s-text>
              ))}
            </s-stack>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
