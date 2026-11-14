import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { createT } from "@app/i18n";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { ensurePixel } from "../lib/web-pixel.server";
import { localeFromRequest } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  // স্টোরের পিক্সেল (Analytics আর Facebook Pixels) চালু আর হালনাগাদ রাখা; ব্যর্থ হলেও অ্যাপ খুলবে
  await ensurePixel(admin, shop).catch((error) => console.warn("[pixel]", error));

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", locale: localeFromRequest(request) };
};

export default function App() {
  const { apiKey, locale } = useLoaderData<typeof loader>();
  const t = createT(locale);

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">{t("nav.dashboard")}</s-link>
        <s-link href="/app/tools">{t("nav.tools")}</s-link>
        <s-link href="/app/ai">{t("nav.ai")}</s-link>
        <s-link href="/app/offers">{t("nav.offers")}</s-link>
        <s-link href="/app/reviews">{t("nav.reviews")}</s-link>
        <s-link href="/app/marketing">{t("nav.marketing")}</s-link>
        <s-link href="/app/integrations">{t("nav.integrations")}</s-link>
        <s-link href="/app/analytics">{t("nav.analytics")}</s-link>
        <s-link href="/app/speed">{t("nav.speed")}</s-link>
        <s-link href="/app/plans">{t("nav.plans")}</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
