import { useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { canUseTool, CATEGORIES } from "@app/tool-sdk";

import { authenticate } from "../shopify.server";
import { ensureShop, planOf } from "../lib/shop.server";
import { getToolStates, saveTool, ToolError } from "../lib/tools.server";
import { useT } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const plan = planOf(shop);
  const states = await getToolStates(shop.id);
  return {
    plan,
    tools: states.map(({ tool, enabled }) => ({
      id: tool.id,
      category: tool.category,
      plan: tool.plan,
      enabled,
      allowed: plan !== null && canUseTool(tool, plan),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const form = await request.formData();
  const toolId = String(form.get("toolId"));
  const enabled = form.get("enabled") === "true";
  try {
    const saved = await saveTool(admin, { id: shop.id, plan: planOf(shop) }, toolId, { enabled });
    const pixelPending = saved.pixel === "meta-pending" || saved.pixel === "failed";
    return { ok: true as const, toolId, enabled, pixelPending };
  } catch (error) {
    if (error instanceof ToolError) return { ok: false as const, toolId, error: error.code };
    throw error;
  }
};

export default function ToolsPage() {
  const { tools } = useLoaderData<typeof loader>();
  const t = useT();
  const fetcher = useFetcher<typeof action>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((tool) => {
      if (category && tool.category !== category) return false;
      if (!q) return true;
      return `${t(`tool.${tool.id}.name`)} ${t(`tool.${tool.id}.description`)}`
        .toLowerCase()
        .includes(q);
    });
  }, [tools, query, category, t]);

  const pendingId = fetcher.state !== "idle" ? String(fetcher.formData?.get("toolId")) : null;

  return (
    <s-page heading={t("tools.title")}>
      <s-button slot="secondary-actions" href="/app/placement">
        {t("placement.title")}
      </s-button>
      {fetcher.data?.ok && fetcher.data.pixelPending && (
        <s-banner tone="warning">{t("tools.pixelPending")}</s-banner>
      )}
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-search-field
            label={t("tools.search")}
            labelAccessibilityVisibility="exclusive"
            placeholder={t("tools.search")}
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <s-select
            label={t("tools.allCategories")}
            labelAccessibilityVisibility="exclusive"
            value={category}
            onChange={(e) => setCategory(e.currentTarget.value)}
          >
            <s-option value="">{t("tools.allCategories")}</s-option>
            {CATEGORIES.map((c) => (
              <s-option key={c} value={c}>
                {t(`category.${c}`)}
              </s-option>
            ))}
          </s-select>
        </s-stack>
      </s-section>

      {visible.map((tool) => {
        const enabled =
          pendingId === tool.id ? fetcher.formData?.get("enabled") === "true" : tool.enabled;
        return (
          <s-section key={tool.id}>
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-stack direction="block" gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-heading>{t(`tool.${tool.id}.name`)}</s-heading>
                  <s-badge>{t(`category.${tool.category}`)}</s-badge>
                  {tool.plan === "professional" && (
                    <s-badge tone="info">{t("tools.locked")}</s-badge>
                  )}
                </s-stack>
                <s-text color="subdued">{t(`tool.${tool.id}.description`)}</s-text>
              </s-stack>
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button href={`/app/tools/${tool.id}`} variant="tertiary">
                  {t("tools.configure")}
                </s-button>
                {tool.allowed ? (
                  <s-switch
                    label={enabled ? t("tools.on") : t("tools.off")}
                    checked={enabled}
                    onChange={() =>
                      fetcher.submit(
                        { toolId: tool.id, enabled: String(!enabled) },
                        { method: "POST" },
                      )
                    }
                  />
                ) : (
                  <s-button href="/app/plans">{t("tools.upgrade")}</s-button>
                )}
              </s-stack>
            </s-stack>
          </s-section>
        );
      })}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
