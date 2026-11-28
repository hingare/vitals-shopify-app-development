import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { OpenFromAdmin } from "../../components/OpenFromAdmin";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

/**
 * Shopify-র লাইব্রেরি দোকান চিনতে না পারলে এখানে পাঠায়। ঠিকানায় দোকানের নাম থাকলে login() সোজা
 * Shopify-তে (ইনস্টল বা অ্যাপ) পাঠিয়ে দেয়; না থাকলে দোকানের ঠিকানা লেখার ফর্ম নয়, অ্যাডমিন থেকে
 * খোলার পথ দেখানো হয় (App Store-এর শর্ত ২.৩.১)।
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!new URL(request.url).searchParams.get("shop")) return { error: undefined };
  return { error: loginErrorMessage(await login(request)).shop };
};

export default function Auth() {
  const { error } = useLoaderData<typeof loader>();
  return <OpenFromAdmin error={error} />;
}
