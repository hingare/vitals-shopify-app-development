import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { registry } from "@app/tools";
import { canUseTool, z } from "@app/tool-sdk";

import { authenticate } from "../shopify.server";
import { ensureShop, planOf } from "../lib/shop.server";
import { getToolStates, saveTool, ToolError } from "../lib/tools.server";
import { useT } from "../lib/i18n";
import { SettingsForm, type JsonSchema } from "../components/SettingsForm";
import { previews } from "../components/previews";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const tool = registry.get(params.toolId ?? "");
  if (!tool) throw new Response("Not found", { status: 404 });
  const shop = await ensureShop(session.shop);
  const plan = planOf(shop);
  const state = (await getToolStates(shop.id)).find((s) => s.tool.id === tool.id)!;
  return {
    id: tool.id,
    plan: tool.plan,
    allowed: plan !== null && canUseTool(tool, plan),
    nativeAlternative: tool.shopifyNativeAlternative ?? null,
    enabled: state.enabled,
    settings: state.settings as Record<string, unknown>,
    schema: z.toJSONSchema(tool.settings, { io: "input" }) as JsonSchema,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const body = (await request.json()) as { enabled: boolean; settings: unknown };
  try {
    const saved = await saveTool(
      admin,
      { id: shop.id, plan: planOf(shop) },
      params.toolId ?? "",
      body,
    );
    // সেভ হয়েছে, কিন্তু স্টোরের পিক্সেলে বদলটা এখনো পৌঁছায়নি (Facebook Pixels)
    const pixelPending = saved.pixel === "meta-pending" || saved.pixel === "failed";
    return { ok: true as const, pixelPending };
  } catch (error) {
    if (error instanceof ToolError)
      return { ok: false as const, error: error.code, message: error.message };
    throw error;
  }
};

export default function ToolSettingsPage() {
  const data = useLoaderData<typeof loader>();
  const t = useT();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [settings, setSettings] = useState(data.settings);
  const [enabled, setEnabled] = useState(data.enabled);
  const Preview = previews[data.id];
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      if (fetcher.data.pixelPending) shopify.toast.show(t("tools.pixelPending"), { isError: true });
      else shopify.toast.show(t("tools.saved"));
    }
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.ok) {
      shopify.toast.show(fetcher.data.message, { isError: true });
    }
  }, [fetcher.state, fetcher.data, shopify, t]);

  const save = () =>
    fetcher.submit(JSON.stringify({ enabled, settings }), {
      method: "POST",
      encType: "application/json",
    });

  return (
    <s-page heading={t(`tool.${data.id}.name`)}>
      <s-link slot="breadcrumb-actions" href="/app/tools">
        {t("nav.tools")}
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        {...(saving ? { loading: true } : {})}
      >
        {t("tools.save")}
      </s-button>

      {data.nativeAlternative && (
        <s-banner tone="warning">
          {t("tools.nativeWarning", { feature: data.nativeAlternative })}
        </s-banner>
      )}
      {!data.allowed && (
        <s-banner tone="info">
          {t("tools.locked")}. <s-link href="/app/plans">{t("tools.upgrade")}</s-link>
        </s-banner>
      )}

      <s-section heading={t("tools.settings")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t(`tool.${data.id}.description`)}</s-paragraph>
          <s-switch
            label={t("tools.enabled")}
            checked={enabled}
            disabled={!data.allowed}
            onChange={() => setEnabled(!enabled)}
          />
          <SettingsForm schema={data.schema} values={settings} onChange={setSettings} />
        </s-stack>
      </s-section>

      {Preview && (
        <s-section slot="aside" heading={t("tools.preview")}>
          <Preview settings={settings} />
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
