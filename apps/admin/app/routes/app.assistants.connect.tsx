import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop, planOf } from "../lib/shop.server";
import { consentView, decideConsent } from "../lib/mcp/oauth.server";
import { useT } from "../lib/i18n";

/**
 * AI সহকারীর সংযোগে মার্চেন্টের সম্মতি (OAuth-এর মাঝের ধাপ)। পাতাটা Shopify অ্যাডমিনের ভেতরে খোলে,
 * তাই অ্যাডমিনে লগইন থাকাটাই প্রমাণ যে তিনি এই স্টোরের লোক। সিদ্ধান্তের পর পুরো জানালা
 * /oauth/complete হয়ে সহকারীর কাছে ফেরে।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const requestId = new URL(request.url).searchParams.get("request") ?? "";
  return {
    professional: planOf(shop) === "professional",
    view: await consentView(requestId, shop.id),
  };
};

type Result = { ok: true; next: string; allowed: boolean } | { ok: false; problem: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as { request?: unknown; allow?: unknown; write?: unknown };
  const allow = body.allow === true;
  if (allow && planOf(shop) !== "professional") {
    return { ok: false, problem: "plan" } satisfies Result;
  }
  const result = await decideConsent(String(body.request ?? ""), shop, {
    allow,
    write: body.write === true,
  });
  if ("problem" in result) return { ok: false, problem: result.problem } satisfies Result;
  return { ok: true, next: result.next, allowed: allow } satisfies Result;
};

export default function ConnectAssistantPage() {
  const { professional, view } = useLoaderData<typeof loader>();
  const t = useT();
  const fetcher = useFetcher<typeof action>();
  const [write, setWrite] = useState(true);
  const result = fetcher.data;
  const next = result?.ok ? result.next : null;

  useEffect(() => {
    // অ্যাডমিনের ফ্রেম থেকে বেরিয়ে পুরো জানালায় (App Bridge "_top" সামলায়)
    if (next) window.open(next, "_top");
  }, [next]);

  const decide = (allow: boolean) =>
    fetcher.submit(JSON.stringify({ request: view.problem ? "" : view.requestId, allow, write }), {
      method: "POST",
      encType: "application/json",
    });

  if (view.problem) {
    return (
      <s-page heading={t("assistants.connect.title")}>
        <s-section>
          <s-banner tone="warning">{t(`assistants.connect.problem.${view.problem}`)}</s-banner>
        </s-section>
      </s-page>
    );
  }

  if (next) {
    return (
      <s-page heading={t("assistants.connect.title")}>
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("assistants.connect.redirecting")}</s-paragraph>
            <s-stack direction="inline">
              <s-link href={next} target="_top">
                {t("assistants.connect.continue", { host: view.returnTo })}
              </s-link>
            </s-stack>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const busy = fetcher.state !== "idle";
  const problem = result && !result.ok ? result.problem : null;

  return (
    <s-page heading={t("assistants.connect.title")}>
      <s-section heading={t("assistants.connect.heading", { name: view.clientName })}>
        <s-stack direction="block" gap="base">
          {!professional && (
            <s-banner tone="warning">
              <s-stack direction="block" gap="small">
                <s-text>{t("assistants.needsPro")}</s-text>
                <s-link href="/app/plans">{t("assistants.upgrade")}</s-link>
              </s-stack>
            </s-banner>
          )}
          {problem && problem !== "plan" && (
            <s-banner tone="critical">{t(`assistants.connect.problem.${problem}`)}</s-banner>
          )}
          <s-text color="subdued">
            {view.verifiedHost
              ? t("assistants.connect.verified", { host: view.verifiedHost })
              : t("assistants.connect.unverified", { name: view.clientName })}
          </s-text>

          <s-stack direction="block" gap="small-200">
            <s-text type="strong">{t("assistants.connect.read")}</s-text>
            <s-text color="subdued">{t("assistants.connect.readHelp")}</s-text>
          </s-stack>
          {view.write && (
            <s-checkbox
              label={t("assistants.connect.write")}
              details={t("assistants.connect.writeHelp")}
              checked={write}
              onChange={(e) => setWrite(e.currentTarget.checked)}
            />
          )}

          <s-banner tone="info">
            {t("assistants.connect.warning")}{" "}
            {t("assistants.connect.returnTo", { host: view.returnTo })}
          </s-banner>
          <s-stack direction="inline" gap="small">
            <s-button
              variant="primary"
              onClick={() => decide(true)}
              {...(!professional ? { disabled: true } : {})}
              {...(busy ? { loading: true } : {})}
            >
              {t("assistants.connect.allow")}
            </s-button>
            <s-button onClick={() => decide(false)} {...(busy ? { disabled: true } : {})}>
              {t("assistants.connect.deny")}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
