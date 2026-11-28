import type { LoginError } from "@shopify/shopify-app-react-router/server";
import { LoginErrorType } from "@shopify/shopify-app-react-router/server";

interface LoginErrorMessage {
  shop?: string;
}

/** লিংকের দোকানের ঠিকানায় গোলমাল হলে কী দেখাবে (ফর্ম নেই, তাই "লিখুন" বলা হয় না) */
export function loginErrorMessage(loginErrors: LoginError): LoginErrorMessage {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "This link doesn't say which store to open." };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "We couldn't read the store address in this link." };
  }

  return {};
}
