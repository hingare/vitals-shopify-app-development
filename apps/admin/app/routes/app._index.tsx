import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop, syncPlanFromBilling } from "../lib/shop.server";
import { getEmbedStatus, getToolStates } from "../lib/tools.server";
import { getSpeedSummary } from "../lib/speed.server";
import { useT } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [plan, embedEnabled, tools, speed] = await Promise.all([
    syncPlanFromBilling(billing, session.shop),
    getEmbedStatus(admin),
    getToolStates(shop.id),
    getSpeedSummary(shop.id),
  ]);
  const handle = session.shop.replace(".myshopify.com", "");
  return {
    plan,
    embedEnabled,
    enabledCount: tools.filter((t) => t.enabled).length,
    totalTools: tools.length,
    baselineScore: speed.baseline?.score ?? null,
    latestScore: speed.latest?.score ?? null,
    // থিম এডিটরে সরাসরি আমাদের app embed খুলে দেয়
    themeEditorUrl: `https://admin.shopify.com/store/${handle}/themes/current/editor?context=apps&activateAppId=${process.env.SHOPIFY_API_KEY}/app-tools-embed`,
  };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const steps = [
    {
      done: data.embedEnabled === true,
      label: t("dashboard.setup.embed"),
      href: data.themeEditorUrl,
      action: t("dashboard.setup.embed.action"),
      external: true,
    },
    {
      done: data.plan !== null,
      label: t("dashboard.setup.plan"),
      href: "/app/plans",
      action: t("plans.choose"),
      external: false,
    },
    {
      done: data.enabledCount > 0,
      label: t("dashboard.setup.tool"),
      href: "/app/tools",
      action: t("nav.tools"),
      external: false,
    },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <s-page heading={t("dashboard.title")}>
      {!allDone && (
        <s-section heading={t("dashboard.setup")}>
          <s-stack direction="block" gap="base">
            {steps.map((step) => (
              <s-stack
                key={step.label}
                direction="inline"
                gap="base"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon
                    type={step.done ? "check-circle-filled" : "circle"}
                    tone={step.done ? "success" : "neutral"}
                  />
                  <s-text>{step.label}</s-text>
                </s-stack>
                {!step.done && (
                  <s-button href={step.href} {...(step.external ? { target: "_blank" } : {})}>
                    {step.action}
                  </s-button>
                )}
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
        <s-section heading={t("dashboard.plan")}>
          <s-text type="strong">{data.plan ? t(`plans.${data.plan}`) : t("plans.none")}</s-text>
        </s-section>
        <s-section heading={t("dashboard.enabledTools")}>
          <s-text type="strong">
            {data.enabledCount} / {data.totalTools}
          </s-text>
        </s-section>
        <s-section heading={t("dashboard.speed")}>
          {data.latestScore === null ? (
            <s-link href="/app/speed">{t("dashboard.speed.empty")}</s-link>
          ) : (
            <s-text type="strong">
              {data.baselineScore !== null ? `${data.baselineScore} → ` : ""}
              {data.latestScore}
            </s-text>
          )}
        </s-section>
      </s-grid>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
