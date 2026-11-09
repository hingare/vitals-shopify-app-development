import { defineTool, themeColors, z } from "@app/tool-sdk";
import { link, text } from "./fields";

/**
 * Shopify-র নিজের ফিচারের বিকল্প। ডিফল্টে বন্ধ, আর Shopify-রটা চালু থাকলে উইজেট নিজেই থেমে যায়
 * (দুবার দাম বা দুটো ব্যানার কখনো নয়)।
 */

export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "INR",
  "BDT",
  "PKR",
  "AED",
  "SAR",
  "JPY",
  "CNY",
  "SGD",
  "MYR",
  "NZD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "ZAR",
] as const;

export const currencyConverter = defineTool({
  id: "currency-converter",
  category: "local",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  shopifyNativeAlternative: "Shopify Markets",
  offByDefault: true,
  settings: z.object({
    currencies: z
      .array(z.enum(CURRENCIES))
      .min(1)
      .max(20)
      .default(["USD", "EUR", "GBP", "CAD", "AUD"]),
    autoDetect: z.boolean().default(true),
    position: z.enum(["bottom-left", "bottom-right"]).default("bottom-right"),
    checkoutNote: text(
      150,
      "Prices are shown in {currency}. You'll pay in {shopCurrency} at checkout.",
    ),
    colors: themeColors(),
  }),
});

export const cookiesBanner = defineTool({
  id: "cookies-banner",
  category: "local",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  shopifyNativeAlternative: "Shopify's cookie banner (Customer Privacy settings)",
  offByDefault: true,
  settings: z.object({
    message: text(
      300,
      "We use cookies to make the store work, understand how it's used and show relevant ads.",
    ),
    acceptText: text(30, "Accept"),
    declineText: text(30, "Decline"),
    privacyLink: link().default("/policies/privacy-policy"),
    privacyText: text(40, "Privacy policy"),
    onlyWhereRequired: z.boolean().default(true),
    position: z.enum(["bottom", "top"]).default("bottom"),
    colors: themeColors({ background: "#111827", text: "#FFFFFF", accent: "#FFFFFF" }),
  }),
});

export const geolocationRedirect = defineTool({
  id: "geolocation-redirect",
  category: "local",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  shopifyNativeAlternative: "Shopify Geolocation app",
  offByDefault: true,
  settings: z.object({
    geoMessage: text(150, "It looks like you're in {country}. Shop in the store for your country?"),
    switchText: text(40, "Switch"),
    stayText: text(40, "Stay here"),
    /** একটা লাইনে একটা নিয়ম: "BD=https://bd.example.com" */
    customRedirects: z
      .string()
      .trim()
      .max(2000)
      .regex(
        /^(\s*[A-Za-z]{2}\s*=\s*https:\/\/\S+\s*)*$/,
        "One rule per line, like BD=https://bd.example.com",
      )
      .default(""),
    colors: themeColors(),
  }),
});
