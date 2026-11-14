import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { createT, resolveLocale } from "@app/i18n";
import { completeAuthorization } from "../lib/mcp/oauth.server";

/**
 * সম্মতির পাতা থেকে পুরো জানালা এখানে আসে, আর এখান থেকে সহকারীর ঠিকানায় (code সহ, বা "দেননি")।
 * code এখানেই তৈরি হয় আর একবারই দেওয়া হয় (app/lib/mcp/oauth.server.ts)।
 */
export const meta: MetaFunction = () => [{ title: "Connect an AI assistant" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const params = new URL(request.url).searchParams;
  const next = await completeAuthorization(params.get("request") ?? "", params.get("sig") ?? "");
  if (next) {
    return redirect(next, {
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  }
  return data(
    { locale: resolveLocale(request.headers.get("accept-language")) },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
};

export default function CompleteProblem() {
  const { locale } = useLoaderData<typeof loader>();
  const t = createT(locale);
  return (
    <>
      <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      <s-page heading={t("oauth.title")}>
        <s-section heading={t("oauth.error.heading")}>
          <s-paragraph>{t("oauth.expired")}</s-paragraph>
        </s-section>
      </s-page>
    </>
  );
}
