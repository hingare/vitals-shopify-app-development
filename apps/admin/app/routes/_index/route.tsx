import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { OpenFromAdmin } from "../../components/OpenFromAdmin";

/** অ্যাপের মূল ঠিকানা: Shopify দোকানের নাম দিয়ে পাঠালে অ্যাপে যায়, নইলে অ্যাডমিন থেকে খোলার পথ দেখায় */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function Landing() {
  return <OpenFromAdmin />;
}
