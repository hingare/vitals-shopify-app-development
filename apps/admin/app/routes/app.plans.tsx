import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop, isTestBilling, syncPlanFromBilling } from "../lib/shop.server";
import { isPlanKey, PLAN_KEYS, PRICES, TRIAL_DAYS } from "../lib/plans";
import { useT } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  await ensureShop(session.shop);
  const plan = await syncPlanFromBilling(billing, session.shop);
  return { plan };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const form = await request.formData();
  const key = form.get("plan");
  if (!isPlanKey(key)) throw new Response("Unknown plan", { status: 400 });
  // Shopify-র বিল অনুমোদন পেজে নিয়ে যায়; অনুমোদনের পর অ্যাপে ফিরে আসে
  return billing.request({ plan: key, isTest: isTestBilling() });
};

export default function PlansPage() {
  const { plan } = useLoaderData<typeof loader>();
  const t = useT();
  const fetcher = useFetcher();
  const [interval, setBillingInterval] = useState<"monthly" | "annual">("monthly");

  const cards = [
    {
      tier: "starter" as const,
      key: interval === "monthly" ? PLAN_KEYS.STARTER_MONTHLY : PLAN_KEYS.STARTER_ANNUAL,
    },
    {
      tier: "professional" as const,
      key: interval === "monthly" ? PLAN_KEYS.PRO_MONTHLY : PLAN_KEYS.PRO_ANNUAL,
    },
  ];

  return (
    <s-page heading={t("plans.title")}>
      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-text>{t("plans.noUsageFees")}</s-text>
          <s-button-group>
            <s-button
              slot="secondary-actions"
              variant={interval === "monthly" ? "primary" : "secondary"}
              onClick={() => setBillingInterval("monthly")}
            >
              {t("plans.monthly")}
            </s-button>
            <s-button
              slot="secondary-actions"
              variant={interval === "annual" ? "primary" : "secondary"}
              onClick={() => setBillingInterval("annual")}
            >
              {t("plans.annual")}
            </s-button>
          </s-button-group>
        </s-stack>
      </s-section>

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="base">
        {cards.map(({ tier, key }) => {
          const price = PRICES[key];
          const current = plan === tier;
          const submitting = fetcher.state !== "idle" && fetcher.formData?.get("plan") === key;
          return (
            <s-section key={tier} heading={t(`plans.${tier}`)}>
              <s-stack direction="block" gap="base">
                <s-heading>
                  ${price.amount.toFixed(2)}
                  {interval === "monthly" ? t("plans.perMonth") : t("plans.perYear")}
                </s-heading>
                <s-text color="subdued">{t(`plans.${tier}.summary`)}</s-text>
                <s-badge tone="success">{t("plans.trial", { days: TRIAL_DAYS })}</s-badge>
                {current ? (
                  <s-badge tone="info">{t("plans.current")}</s-badge>
                ) : (
                  <s-button
                    variant="primary"
                    {...(submitting ? { loading: true } : {})}
                    onClick={() => fetcher.submit({ plan: key }, { method: "POST" })}
                  >
                    {t("plans.choose")}
                  </s-button>
                )}
              </s-stack>
            </s-section>
          );
        })}
      </s-grid>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
