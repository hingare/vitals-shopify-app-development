import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getRates } from "../lib/fx.server";

/** স্টোরফ্রন্টের Currency Converter এখান থেকে হার নেয় (/apps/app-tools/fx?base=USD) */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const base = new URL(request.url).searchParams.get("base") ?? "";
  const rates = await getRates(base);
  return new Response(JSON.stringify({ base, rates }), {
    status: rates ? 200 : 502,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
};
