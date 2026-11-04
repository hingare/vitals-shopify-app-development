import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { createT } from "@app/i18n";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { localeFromRequest } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await ensureShop(session.shop);

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
