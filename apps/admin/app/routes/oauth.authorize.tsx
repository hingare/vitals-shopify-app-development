import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { createT, resolveLocale } from "@app/i18n";
import { requestIp } from "../lib/mcp/http.server";
import { startAuthorization } from "../lib/mcp/oauth.server";

/**
 * AI সহকারী মার্চেন্টকে এখানে পাঠায় (OAuth authorize)। আমরা যাচাই করে তাকে তার Shopify অ্যাডমিনে
 * সম্মতির পাতায় নিই; স্টোর জানা না থাকলে আগে স্টোর বেছে নেওয়ার পাতা। ভুল অনুরোধে শুধু এই পাতায় কারণ দেখায়।
 */
export const meta: MetaFunction = () => [{ title: "Connect an AI assistant" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await startAuthorization(new URL(request.url).searchParams, requestIp(request));
  if (result.kind === "redirect") return redirect(result.url);
  if (result.kind === "choose_store") {
    return redirect(`/oauth/store?request=${encodeURIComponent(result.requestId)}`);
  }
  return data(
    { locale: resolveLocale(request.headers.get("accept-language")), message: result.message },
    { status: 400 },
  );
};

export default function AuthorizeProblem() {
  const { locale, message } = useLoaderData<typeof loader>();
  const t = createT(locale);
  return (
    <>
      <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      <s-page heading={t("oauth.title")}>
        <s-section heading={t("oauth.error.heading")}>
          <s-paragraph>{message}</s-paragraph>
        </s-section>
      </s-page>
    </>
  );
}
