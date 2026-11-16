import { buildStoreConfig, registry } from "@app/tools";
import { canUseTool, type Plan } from "@app/tool-sdk";
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { syncOffers } from "./offers.server";
import { readPlacement } from "./placement";
import { syncPixel, type PixelSync } from "./web-pixel.server";

export const CONFIG_NAMESPACE = "app_config";
export const CONFIG_KEY = "tools";

/** GraphQL client যেটা authenticate.admin বা unauthenticated.admin দুটোই দেয় */
export interface GraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

export async function getToolStates(shopId: string) {
  const rows = await db.toolSetting.findMany({ where: { shopId } });
  const byId = new Map(rows.map((r) => [r.toolId, r]));
  return registry.all.map((tool) => {
    const row = byId.get(tool.id);
    const parsed = tool.settings.safeParse(row?.settings ?? {});
    return {
      tool,
      enabled: row?.enabled ?? false,
      settings: parsed.success ? parsed.data : tool.settings.parse({}),
    };
  });
}

export class ToolError extends Error {
  constructor(
    public code: "unknown_tool" | "plan_required" | "invalid_settings",
    message: string,
  ) {
    super(message);
  }
}

/**
 * টুল চালু/বন্ধ বা সেটিংস সেভ করে, তারপর স্টোরের কনফিগ আপডেট করে।
 * যে টুল web pixel দিয়ে চলে (Facebook Pixels) তার সেটিংস পিক্সেলেও পাঠানো হয়;
 * ফলাফল pixel-এ জানানো হয়, যাতে পাঠানো না গেলে মার্চেন্টকে বলা যায়।
 */
export async function saveTool(
  admin: GraphqlClient,
  shop: { id: string; plan: Plan | null },
  toolId: string,
  input: { enabled?: boolean; settings?: unknown },
): Promise<{ pixel: PixelSync | null }> {
  const tool = registry.get(toolId);
  if (!tool) throw new ToolError("unknown_tool", `Unknown tool ${toolId}`);
  if (input.enabled && (!shop.plan || !canUseTool(tool, shop.plan))) {
    throw new ToolError("plan_required", `${toolId} needs the ${tool.plan} plan`);
  }
  let settings: Prisma.InputJsonValue | undefined;
  if (input.settings !== undefined) {
    const parsed = tool.settings.safeParse(input.settings);
    if (!parsed.success) throw new ToolError("invalid_settings", parsed.error.message);
    settings = parsed.data as Prisma.InputJsonValue;
  }
  await db.toolSetting.upsert({
    where: { shopId_toolId: { shopId: shop.id, toolId } },
    create: { shopId: shop.id, toolId, enabled: input.enabled ?? false, settings: settings ?? {} },
    update: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(settings !== undefined ? { settings } : {}),
    },
  });
  await syncStoreConfig(admin, shop);
  return { pixel: tool.delivery === "pixel" ? await syncPixel(admin, shop.id) : null };
}

/**
 * চালু টুলগুলোর কনফিগ app-owned metafield-এ লেখে।
 * থিমের app embed এটা Liquid দিয়ে পেজে বসায়, তাই স্টোরে কোনো API কল লাগে না।
 */
export async function syncStoreConfig(
  admin: GraphqlClient,
  shop: { id: string; plan: Plan | null },
) {
  const [rows, shopRow] = await Promise.all([
    db.toolSetting.findMany({ where: { shopId: shop.id } }),
    db.shop.findUnique({ where: { id: shop.id }, select: { placement: true } }),
  ]);
  const config = buildStoreConfig(
    registry,
    rows.map((r) => ({ toolId: r.toolId, enabled: r.enabled, settings: r.settings })),
    shop.plan,
  );

  const idRes = await admin.graphql(`#graphql
    query AppInstallationId { currentAppInstallation { id } shop { id } }`);
  const idJson = (await idRes.json()) as {
    data?: { currentAppInstallation?: { id: string }; shop?: { id: string } };
  };
  const ownerId = idJson.data?.currentAppInstallation?.id;
  const shopGid = idJson.data?.shop?.id;
  if (!ownerId || !shopGid) throw new Error("Could not read app installation id");

  // চেকআউটের অফার discount আর স্টোরফ্রন্ট ও চেকআউটের অফার তালিকাও একই সাথে
  const offersMetafields = await syncOffers(
    admin,
    shop,
    { installationId: ownerId, shopGid },
    config.tools.map((t) => t.id),
  );

  const res = await admin.graphql(
    `#graphql
    mutation SetStoreConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: CONFIG_NAMESPACE,
            key: CONFIG_KEY,
            type: "json",
            value: JSON.stringify({ ...config, placement: readPlacement(shopRow?.placement) }),
          },
          ...offersMetafields,
        ],
      },
    },
  );
  const json = (await res.json()) as {
    data?: { metafieldsSet?: { userErrors: Array<{ message: string }> } };
  };
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join(", "));
  return config;
}

/** থিম এডিটরে সরাসরি আমাদের app embed খুলে দেয় (চালু করার জন্য) */
export function embedEditorUrl(shopDomain: string): string {
  const handle = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${handle}/themes/current/editor?context=apps&activateAppId=${process.env.SHOPIFY_API_KEY}/app-tools-embed`;
}

/**
 * থিমে আমাদের app embed চালু আছে কিনা দেখে (config/settings_data.json থেকে)।
 * পড়া না গেলে null।
 */
export async function getEmbedStatus(admin: GraphqlClient): Promise<boolean | null> {
  try {
    const res = await admin.graphql(`#graphql
      query MainThemeSettings {
        themes(first: 1, roles: [MAIN]) {
          nodes {
            files(filenames: ["config/settings_data.json"]) {
              nodes { body { ... on OnlineStoreThemeFileBodyText { content } } }
            }
          }
        }
      }`);
    const json = (await res.json()) as {
      data?: {
        themes?: { nodes: Array<{ files?: { nodes: Array<{ body?: { content?: string } }> } }> };
      };
    };
    const content = json.data?.themes?.nodes[0]?.files?.nodes[0]?.body?.content;
    if (!content) return null;
    return isEmbedEnabled(content);
  } catch {
    return null;
  }
}

export function isEmbedEnabled(settingsDataJson: string): boolean {
  const withoutComments = settingsDataJson.replace(/\/\*[\s\S]*?\*\//g, "");
  const data = JSON.parse(withoutComments) as {
    current?: { blocks?: Record<string, { type?: string; disabled?: boolean }> } | string;
  };
  const current = typeof data.current === "object" ? data.current : undefined;
  return Object.values(current?.blocks ?? {}).some(
    (b) =>
      typeof b.type === "string" &&
      b.type.includes("/blocks/app-tools-embed/") &&
      b.disabled !== true,
  );
}
