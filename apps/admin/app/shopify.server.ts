import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  BillingReplacementBehavior,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { PRICES, PLAN_KEYS, TRIAL_DAYS, type PlanKey } from "./lib/plans";
import { BodyTooLargeError, limitBody } from "./lib/request.server";

function plan(key: PlanKey) {
  const price = PRICES[key];
  return {
    trialDays: TRIAL_DAYS,
    // আপগ্রেড/ডাউনগ্রেডে আগের subscription সাথে সাথে বদলে যায়, দুটো বিল হয় না
    replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
    lineItems: [
      {
        amount: price.amount,
        currencyCode: "USD" as string,
        interval:
          price.interval === "annual"
            ? (BillingInterval.Annual as const)
            : (BillingInterval.Every30Days as const),
      },
    ],
  };
}

/** শুধু দুটি প্ল্যান, মাসিক বা বার্ষিক। কোনো usage charge নেই। */
export const billingConfig = {
  [PLAN_KEYS.STARTER_MONTHLY]: plan(PLAN_KEYS.STARTER_MONTHLY),
  [PLAN_KEYS.STARTER_ANNUAL]: plan(PLAN_KEYS.STARTER_ANNUAL),
  [PLAN_KEYS.PRO_MONTHLY]: plan(PLAN_KEYS.PRO_MONTHLY),
  [PLAN_KEYS.PRO_ANNUAL]: plan(PLAN_KEYS.PRO_ANNUAL),
};

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: billingConfig,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
/** Shopify HTTPS webhook-এর body সর্বোচ্চ ৫MB; দ্বিগুণ জায়গা রেখে এর বেশি হলে পড়া থামে */
const MAX_WEBHOOK_BYTES = 10 * 1024 * 1024;

/**
 * Shopify-র লাইব্রেরি সই মেলানোর আগে webhook-এর পুরো body মেমরিতে পড়ে। তাই যে কেউ webhook-এর
 * ঠিকানায় বিশাল body পাঠালে সার্ভারের মেমরি ভরে যেত; এখানে সেটা মাঝপথেই থামে (413)।
 */
const webhook = (async (request: Request) => {
  try {
    return await shopify.authenticate.webhook(limitBody(request, MAX_WEBHOOK_BYTES));
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw new Response(null, { status: 413 });
    throw error;
  }
}) as typeof shopify.authenticate.webhook;

export const authenticate = { ...shopify.authenticate, webhook };
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
