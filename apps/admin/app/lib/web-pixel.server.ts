import { randomBytes } from "node:crypto";
import { facebookPixels } from "@app/tools";
import db from "../db.server";
import { enabledSettings } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * স্টোরে আমাদের web pixel চালু রাখা আর তার সেটিংস মিলিয়ে রাখা।
 *
 * একই পিক্সেল দুটো কাজ করে (Shopify-তে একটা অ্যাপের একটাই web pixel রেকর্ড থাকে):
 * ১. স্টোরের Analytics: কোন URL-এ, কোন চাবি দিয়ে ইভেন্ট পাঠাবে (ingestKey, endpoint)।
 * ২. Facebook Pixels টুল: মার্চেন্টের Meta পিক্সেলের id (metaPixels)। টুল বন্ধ থাকলে বা প্ল্যানে
 *    না থাকলে এখানে "none" যায়, তখন পিক্সেল Meta-তে কিছুই পাঠায় না।
 *
 * Shopify সেটিংসকে extension-এর shopify.extension.toml-এর সাথে মিলিয়ে দেখে: ঘোষণার বাইরের
 * চাবি বা বাদ পড়া চাবি থাকলে পুরো অনুরোধ ফেরত দেয়। তাই extension-এর নতুন সংস্করণ স্টোরে
 * পৌঁছানোর আগে metaPixels পাঠালে ব্যর্থ হয়; তখন পুরোনো দুই চাবি দিয়ে চেষ্টা করা হয়, যাতে
 * Analytics বন্ধ না থাকে, আর পরের বার আবার পুরোটা পাঠানোর চেষ্টা হয়।
 */

export function ingestEndpoint(appUrl = process.env.SHOPIFY_APP_URL ?? ""): string {
  return `${appUrl.replace(/\/+$/, "")}/ingest/pixel`;
}

/**
 * - unchanged: আগে থেকেই ঠিক ছিল, কোনো API কল হয়নি
 * - synced: Shopify-তে নতুন সেটিংস গেছে
 * - meta-pending: Analytics চলছে, কিন্তু Meta পিক্সেলের id এখনো পাঠানো যায়নি
 * - failed: পিক্সেল বসানো যায়নি
 * - skipped: এখন চেষ্টা করা হয়নি (অ্যাপের URL নেই, বা একটু আগে ব্যর্থ হয়েছে)
 */
export type PixelSync = "unchanged" | "synced" | "meta-pending" | "failed" | "skipped";

export interface PixelShop {
  id: string;
  plan: string | null;
  ingestKey: string | null;
  pixelId: string | null;
  pixelEndpoint: string | null;
  pixelSettings: string | null;
}

interface PixelPayload {
  webPixel?: { id: string } | null;
  userErrors: Array<{ code?: string | null; message: string }>;
}

/** ব্যর্থ হলে অ্যাপের প্রতিটা পেজ খোলায় আবার চেষ্টা না করে এতক্ষণ অপেক্ষা */
const RETRY_AFTER_MS = 10 * 60_000;
const retryAt = new Map<string, number>();

/** টেস্টের জন্য: ব্যর্থ চেষ্টার স্মৃতি মুছে দেয় */
export function resetPixelRetry() {
  retryAt.clear();
}

/** চালু আর প্ল্যানে অনুমোদিত হলে মার্চেন্টের Meta পিক্সেল id (একই id একবার) */
export async function metaPixelIds(shop: { id: string; plan: string | null }): Promise<string[]> {
  const settings = await enabledSettings(shop, facebookPixels);
  if (!settings) return [];
  const ids = [settings.pixelId1, settings.pixelId2, settings.pixelId3].filter(Boolean);
  return [...new Set(ids)];
}

/** Shopify-তে যে সেটিংস যায়; metaPixels ফাঁকা রাখা যায় না বলে id না থাকলে "none" */
export function pixelSettingsJson(ingestKey: string, endpoint: string, metaPixels?: string[]) {
  return JSON.stringify(
    metaPixels === undefined
      ? { ingestKey, endpoint }
      : { ingestKey, endpoint, metaPixels: metaPixels.join(",") || "none" },
  );
}

/**
 * স্টোরে আমাদের web pixel আছে আর তার সেটিংস এখনকার অবস্থার সাথে মেলে তা নিশ্চিত করে।
 * অ্যাপ খুললেই চলে; সব ঠিক থাকলে কোনো API কল হয় না।
 * force: মার্চেন্ট এইমাত্র কিছু সেভ করেছেন, তাই আগের ব্যর্থতার অপেক্ষা না মেনে এখনই চেষ্টা।
 */
export async function ensurePixel(
  admin: GraphqlClient,
  shop: PixelShop,
  options: { force?: boolean; now?: number } = {},
): Promise<PixelSync> {
  if (!process.env.SHOPIFY_APP_URL) return "skipped";
  const endpoint = ingestEndpoint();
  const now = options.now ?? Date.now();
  const ingestKey = shop.ingestKey ?? randomBytes(18).toString("base64url");
  const metaIds = await metaPixelIds(shop);
  const wanted = pixelSettingsJson(ingestKey, endpoint, metaIds);

  if (shop.pixelId && shop.ingestKey && shop.pixelSettings === wanted) return "unchanged";
  if (!options.force && (retryAt.get(shop.id) ?? 0) > now) return "skipped";

  let pixelId = shop.pixelId;

  const run = async (settings: string, id: string | null) => {
    const res = await admin.graphql(
      id
        ? `#graphql
          mutation UpdatePixel($id: ID!, $settings: JSON!) {
            webPixelUpdate(id: $id, webPixel: { settings: $settings }) {
              webPixel { id } userErrors { code message }
            }
          }`
        : `#graphql
          mutation CreatePixel($settings: JSON!) {
            webPixelCreate(webPixel: { settings: $settings }) {
              webPixel { id } userErrors { code message }
            }
          }`,
      { variables: id ? { id, settings } : { settings } },
    );
    const json = (await res.json()) as { data?: Record<string, PixelPayload | null> };
    return json.data?.[id ? "webPixelUpdate" : "webPixelCreate"] ?? null;
  };
  const failedWith = (result: PixelPayload | null, code: string) =>
    Boolean(result?.userErrors.some((e) => e.code === code));

  /** সেটিংস পাঠায়; পিক্সেল আগে থেকে থাকলে বা হারিয়ে গিয়ে থাকলে সেটা সামলে নেয় */
  const apply = async (settings: string) => {
    let result = await run(settings, pixelId);
    if (pixelId && failedWith(result, "NOT_FOUND")) {
      // আমাদের মনে রাখা পিক্সেল আর নেই (যেমন আনইনস্টলের পর আবার ইনস্টল): নতুন বানাই
      pixelId = null;
      result = await run(settings, null);
    }
    if (!pixelId && failedWith(result, "TAKEN")) {
      // আগে থেকেই আছে: id খুঁজে আপডেট করি
      const res = await admin.graphql(`#graphql
        query CurrentPixel { webPixel { id } }`);
      const json = (await res.json()) as { data?: { webPixel?: { id: string } | null } };
      const id = json.data?.webPixel?.id;
      if (id) {
        pixelId = id;
        result = await run(settings, id);
      }
    }
    if (result?.webPixel?.id) pixelId = result.webPixel.id;
    return result;
  };

  let sent = wanted;
  let result = await apply(wanted);
  if (!result?.webPixel?.id && failedWith(result, "INVALID_SETTINGS")) {
    // extension-এর পুরোনো সংস্করণ metaPixels চেনে না: Analytics যাতে চালু থাকে তাই পুরোনো দুই চাবি
    sent = pixelSettingsJson(ingestKey, endpoint);
    const basicInPlace =
      pixelId !== null && shop.ingestKey === ingestKey && shop.pixelEndpoint === endpoint;
    if (!basicInPlace) result = await apply(sent);
    else result = { webPixel: { id: pixelId as string }, userErrors: [] };
  }

  const connected = result?.webPixel?.id;
  if (!connected) {
    console.warn("[pixel] could not connect", result?.userErrors);
    retryAt.set(shop.id, now + RETRY_AFTER_MS);
    await db.shop.update({ where: { id: shop.id }, data: { ingestKey } });
    return "failed";
  }
  await db.shop.update({
    where: { id: shop.id },
    data: { ingestKey, pixelId: connected, pixelEndpoint: endpoint, pixelSettings: sent },
  });
  if (sent === wanted) {
    retryAt.delete(shop.id);
    return "synced";
  }
  retryAt.set(shop.id, now + RETRY_AFTER_MS);
  return metaIds.length > 0 ? "meta-pending" : "synced";
}

/**
 * টুল সেভ বা প্ল্যান বদলের পরে: স্টোরের এখনকার রেকর্ড পড়ে পিক্সেলের সেটিংস মিলিয়ে নেয়।
 * ব্যর্থ হলে ভুল ছোড়ে না (সেভ তো হয়েই গেছে), শুধু অবস্থা জানায়।
 */
export async function syncPixel(admin: GraphqlClient, shopId: string): Promise<PixelSync> {
  try {
    const shop = await db.shop.findUnique({ where: { id: shopId } });
    if (!shop || shop.uninstalledAt) return "skipped";
    return await ensurePixel(admin, shop, { force: true });
  } catch (error) {
    console.warn("[pixel] sync failed", error);
    return "failed";
  }
}
