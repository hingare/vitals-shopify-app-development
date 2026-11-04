import { createT, resolveLocale, type Locale } from "@app/i18n";
import { useRouteLoaderData } from "react-router";

/** Shopify অ্যাডমিন URL-এ ?locale=xx পাঠায় */
export function localeFromRequest(request: Request): Locale {
  return resolveLocale(new URL(request.url).searchParams.get("locale"));
}

export function useT() {
  const data = useRouteLoaderData("routes/app") as { locale?: Locale } | undefined;
  return createT(data?.locale ?? "en");
}
