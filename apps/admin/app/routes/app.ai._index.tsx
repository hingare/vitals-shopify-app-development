import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { saveBrand, studioOverview } from "../lib/ai/studio.server";
import { CreditsSummary } from "../components/ai/CreditsSummary";
import { useT } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return studioOverview(shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const ok = await saveBrand(shop.id, await request.json());
  return { ok };
};

export default function AiStudioPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [brand, setBrand] = useState(data.brand);
  const set = (patch: Partial<typeof brand>) => setBrand((b) => ({ ...b, ...patch }));

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show(t("ai.brand.saved"));
    else shopify.toast.show(t("ai.error.invalid"), { isError: true });
  }, [fetcher.state, fetcher.data, shopify, t]);

  return (
    <s-page heading={t("ai.title")}>
      {!data.configured && <s-banner tone="warning">{t("ai.notConfigured")}</s-banner>}
      {!data.professional && (
        <s-banner tone="info">
          {t("ai.needsProfessional")} <s-link href="/app/plans">{t("tools.upgrade")}</s-link>
        </s-banner>
      )}

      <CreditsSummary credits={data.credits} />

      {data.groups.map((group) => (
        <s-section key={group.group} heading={t(`ai.group.${group.group}`)}>
          <s-stack direction="block" gap="base">
            {group.tools.map((tool) => (
              <s-stack
                key={tool.id}
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-stack direction="block" gap="small-200">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-heading>{t(`tool.${tool.id}.name`)}</s-heading>
                    {!tool.ready && <s-badge>{t("ai.comingSoon")}</s-badge>}
                  </s-stack>
                  <s-text color="subdued">{t(`tool.${tool.id}.description`)}</s-text>
                </s-stack>
                {tool.allowed ? (
                  <s-button href={`/app/ai/${tool.id}`} {...(!tool.ready ? { disabled: true } : {})}>
                    {t("tools.open")}
                  </s-button>
                ) : (
                  <s-button href="/app/plans">{t("tools.upgrade")}</s-button>
                )}
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      ))}

      <s-section heading={t("ai.brand.title")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("ai.brand.help")}</s-paragraph>
          <s-text-area
            label={t("ai.brand.voice")}
            details={t("ai.brand.voiceHelp")}
            rows={2}
            maxLength={300}
            value={brand.voice}
            onChange={(e) => set({ voice: e.currentTarget.value })}
          />
          <s-text-field
            label={t("ai.brand.audience")}
            maxLength={200}
            value={brand.audience}
            onChange={(e) => set({ audience: e.currentTarget.value })}
          />
          <s-text-field
            label={t("ai.brand.language")}
            details={t("ai.brand.languageHelp")}
            maxLength={40}
            value={brand.language}
            onChange={(e) => set({ language: e.currentTarget.value })}
          />
          <s-text-field
            label={t("ai.brand.avoid")}
            maxLength={200}
            value={brand.avoid}
            onChange={(e) => set({ avoid: e.currentTarget.value })}
          />
          <s-stack direction="inline">
            <s-button
              variant="primary"
              onClick={() =>
                fetcher.submit(JSON.stringify(brand), {
                  method: "POST",
                  encType: "application/json",
                })
              }
              {...(fetcher.state !== "idle" ? { loading: true } : {})}
            >
              {t("tools.save")}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
