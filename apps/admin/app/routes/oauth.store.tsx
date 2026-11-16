import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import { createT, resolveLocale } from "@app/i18n";
import { pendingStoreRequest, storeConsentUrl } from "../lib/mcp/oauth.server";

/**
 * সহকারী সাধারণ ঠিকানা দিয়ে শুরু করলে (কোন স্টোর জানা নেই): মার্চেন্ট স্টোরের ঠিকানা লেখেন,
 * তারপর সেই স্টোরের অ্যাডমিনে সম্মতির পাতা। কোন স্টোর, সেটা চূড়ান্ত হয় অ্যাডমিনের লগইন দেখে।
 */
export const meta: MetaFunction = () => [{ title: "Connect an AI assistant" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const requestId = new URL(request.url).searchParams.get("request") ?? "";
  const pending = await pendingStoreRequest(requestId);
  return {
    locale: resolveLocale(request.headers.get("accept-language")),
    requestId,
    clientName: pending?.clientName ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const url = await storeConsentUrl(
    String(form.get("request") ?? ""),
    String(form.get("shop") ?? ""),
  );
  return url ? redirect(url) : { invalid: true };
};

export default function ChooseStore() {
  const { locale, requestId, clientName } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const t = createT(locale);
  const [shop, setShop] = useState("");

  return (
    <>
      <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      <s-page heading={t("oauth.title")}>
        {clientName === null ? (
          <s-section heading={t("oauth.error.heading")}>
            <s-paragraph>{t("oauth.expired")}</s-paragraph>
          </s-section>
        ) : (
          <Form method="post">
            <input type="hidden" name="request" value={requestId} />
            <s-section heading={t("oauth.store.heading", { name: clientName })}>
              <s-stack direction="block" gap="base">
                <s-text-field
                  name="shop"
                  label={t("oauth.store.label")}
                  details={t("oauth.store.help")}
                  value={shop}
                  onChange={(e) => setShop(e.currentTarget.value)}
                  autocomplete="on"
                  {...(result?.invalid ? { error: t("oauth.store.invalid") } : {})}
                />
                <s-stack direction="inline">
                  <s-button type="submit" variant="primary">
                    {t("oauth.store.continue")}
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          </Form>
        )}
      </s-page>
    </>
  );
}
