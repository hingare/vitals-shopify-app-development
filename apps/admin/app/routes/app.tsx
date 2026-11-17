import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { createT } from "@app/i18n";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { ensurePixel } from "../lib/web-pixel.server";
import { localeFromRequest } from "../lib/i18n";
import { isDeskShop } from "../lib/support.server";
import { reportClientError } from "../lib/errors";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  // স্টোরের পিক্সেল (Analytics আর Facebook Pixels) চালু আর হালনাগাদ রাখা; ব্যর্থ হলেও অ্যাপ খুলবে
  await ensurePixel(admin, shop).catch((error) => console.warn("[pixel]", error));

  return {
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    locale: localeFromRequest(request),
    // সাপোর্ট ডেস্ক মেনুতে শুধু অ্যাপের মালিকের স্টোরে (SUPPORT_DESK_SHOPS)
    desk: isDeskShop(session.shop),
  };
};

const HOME = { rel: "home" };

export default function App() {
  const { apiKey, locale, desk } = useLoaderData<typeof loader>();
  const t = createT(locale);

  // বোতাম চাপা বা অপেক্ষার কাজে ব্রাউজারে কোড ভাঙলে অ্যাপের ত্রুটির খাতায় (পাতা আঁকায় ভাঙলে ErrorBoundary পাঠায়)
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportClientError(event.error);
    const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        {/* rel="home": অ্যাপের নাম নিজেই হোমে নিয়ে যায়, তাই মেনুতে আলাদা করে দেখায় না
            (App Bridge-এর নিয়ম; Polaris-এর টাইপে rel নেই বলে এভাবে দেওয়া) */}
        <s-link href="/app" {...HOME}>
          {t("nav.dashboard")}
        </s-link>
        <s-link href="/app/tools">{t("nav.tools")}</s-link>
        <s-link href="/app/ai">{t("nav.ai")}</s-link>
        <s-link href="/app/seo">{t("nav.visibility")}</s-link>
        <s-link href="/app/offers">{t("nav.offers")}</s-link>
        <s-link href="/app/reviews">{t("nav.reviews")}</s-link>
        <s-link href="/app/chat">{t("nav.chat")}</s-link>
        <s-link href="/app/recordings">{t("nav.recordings")}</s-link>
        <s-link href="/app/marketing">{t("nav.marketing")}</s-link>
        <s-link href="/app/integrations">{t("nav.integrations")}</s-link>
        <s-link href="/app/assistants">{t("nav.assistants")}</s-link>
        <s-link href="/app/analytics">{t("nav.analytics")}</s-link>
        <s-link href="/app/speed">{t("nav.speed")}</s-link>
        <s-link href="/app/plans">{t("nav.plans")}</s-link>
        <s-link href="/app/help">{t("nav.help")}</s-link>
        {desk && <s-link href="/app/desk">{t("nav.desk")}</s-link>}
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  // ব্রাউজারে পাতা আঁকতে গিয়ে ভাঙলে খাতায় পাঠানো (একবারই; সার্ভারের ত্রুটি সার্ভারেই লেখা হয়েছে)
  reportClientError(error);
  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
