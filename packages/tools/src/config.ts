import { canUseTool, type Plan, type Registry } from "@app/tool-sdk";

export interface SavedToolState {
  toolId: string;
  enabled: boolean;
  settings: unknown;
}

export interface StoreToolConfig {
  id: string;
  settings: Record<string, unknown>;
}

/**
 * স্টোরে যে কনফিগ যাবে (app-owned metafield-এ সেভ হয়, Liquid পেজে বসায়)।
 * শুধু চালু, প্ল্যানে অনুমোদিত আর রেজিস্ট্রিতে থাকা টুল যায়; সেটিংস ডিফল্টসহ পূর্ণ করা হয়।
 */
export function buildStoreConfig(
  registry: Registry,
  states: SavedToolState[],
  plan: Plan | null,
): { tools: StoreToolConfig[] } {
  if (!plan) return { tools: [] };
  const tools: StoreToolConfig[] = [];
  for (const state of states) {
    if (!state.enabled) continue;
    const tool = registry.get(state.toolId);
    if (!tool || !canUseTool(tool, plan)) continue;
    const parsed = tool.settings.safeParse(state.settings ?? {});
    tools.push({
      id: tool.id,
      settings: parsed.success ? parsed.data : tool.settings.parse({}),
    });
  }
  tools.sort((a, b) => a.id.localeCompare(b.id));
  return { tools };
}
