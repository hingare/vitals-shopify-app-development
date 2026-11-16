import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaMessage,
  BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages";
import type { z } from "zod";
import { adjustUsage, reserveUsage, type UsageShop } from "../usage.server";
import { AiError } from "./errors";
import {
  estimateTokens,
  IMAGE_TOKENS,
  knownModel,
  maxCostMicros,
  supportsFallback,
  usageCostMicros,
} from "./pricing";

/**
 * Claude দিয়ে লেখা বানানোর একটাই পথ। প্রতিটা ডাকে:
 * ১. সর্বোচ্চ সম্ভাব্য খরচ স্টোরের মাসিক AI বাজেট থেকে আগে ধরে রাখা হয়; না পারলে ডাকই হয় না ("budget")।
 * ২. উত্তর আসে নির্দিষ্ট JSON আকারে (structured output), Zod দিয়ে মিলিয়ে নেওয়া।
 * ৩. শেষে, সফল হোক বা না হোক, ধরে রাখা টাকা আসল খরচে মেলানো হয় (usage.iterations থেকে, প্রতি মডেলের দামে)।
 */

/** "fast": ছোট আর বেশি সংখ্যার কাজ (alt, মেটা, FAQ)। "smart": পরিকল্পনা, অডিট, পেজ, বর্ণনা। */
export type AiTier = "fast" | "smart";

const DEFAULT_MODELS: Record<AiTier, string> = {
  smart: "claude-opus-5-5",
  fast: "claude-haiku-5-5",
};

/** .env-এ AI_MODEL আর AI_FAST_MODEL দিয়ে বদলানো যায় (দাম pricing.ts-এ থাকতে হবে) */
export function modelFor(tier: AiTier): string {
  const fromEnv = (tier === "smart" ? process.env.AI_MODEL : process.env.AI_FAST_MODEL)?.trim();
  return fromEnv || DEFAULT_MODELS[tier];
}

interface MessagesClient {
  beta: {
    messages: {
      stream(params: BetaMessageStreamParams): { finalMessage(): Promise<BetaMessage> };
    };
  };
}

let client: MessagesClient | null = null;

/** টেস্টে নকল client বসাতে (null দিলে আবার আসলটা) */
export function setAiClientForTests(fake: MessagesClient | null) {
  client = fake;
}

export const aiConfigured = () => Boolean(client ?? process.env.ANTHROPIC_API_KEY?.trim());

function getClient(): MessagesClient {
  // চাবি ANTHROPIC_API_KEY থেকে; SDK নিজেই 429 আর 5xx-এ দুবার আবার চেষ্টা করে
  client ??= new Anthropic() as unknown as MessagesClient;
  return client;
}

export type AiContent = { type: "text"; text: string } | { type: "image"; url: string };

export interface GenerateRequest<S extends z.ZodType> {
  shop: UsageShop;
  tier: AiTier;
  system: string;
  content: AiContent[];
  schema: S;
  /** চিন্তা আর উত্তর মিলিয়ে সর্বোচ্চ টোকেন; খরচের উপরের সীমাও এটা */
  maxTokens: number;
  effort?: "low" | "medium" | "high";
}

export interface GenerateResult<T> {
  data: T;
  costMicros: number;
  model: string;
}

const toBlock = (item: AiContent) =>
  item.type === "text"
    ? { type: "text" as const, text: item.text }
    : { type: "image" as const, source: { type: "url" as const, url: item.url } };

function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AiError("not_configured", error.message);
  }
  if (
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    return new AiError("busy", error.message);
  }
  if (error instanceof Anthropic.APIError) {
    // stream চলার মাঝে সার্ভারের ত্রুটি (যেমন overloaded) status ছাড়া আসে: পরে আবার চেষ্টা করার মতো
    return new AiError(error.status === undefined ? "busy" : "failed", error.message);
  }
  return new AiError("failed", error instanceof Error ? error.message : String(error));
}

export async function generate<S extends z.ZodType>(
  request: GenerateRequest<S>,
): Promise<GenerateResult<z.output<S>>> {
  if (!aiConfigured()) throw new AiError("not_configured");
  const model = modelFor(request.tier);
  if (!knownModel(model)) throw new AiError("not_configured", `No price for model ${model}`);

  const format = betaZodOutputFormat(request.schema);
  const text = request.content.map((item) => (item.type === "text" ? item.text : "")).join("\n");
  const images = request.content.filter((item) => item.type === "image").length;
  const inputTokens =
    estimateTokens(request.system + JSON.stringify(format.schema) + text) + images * IMAGE_TOKENS;
  const reserved = maxCostMicros(model, inputTokens, request.maxTokens);
  const { ok, month } = await reserveUsage(request.shop, "ai", reserved);
  if (!ok) throw new AiError("budget");

  let cost = 0;
  try {
    const params: BetaMessageStreamParams = {
      model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user", content: request.content.map(toBlock) }],
      output_config: {
        effort: request.effort ?? "medium",
        format: { type: "json_schema", schema: format.schema },
      },
      // প্রথম মডেল নিরাপত্তার কারণে না বললে Anthropic-এর ঠিক করা মডেলে একই অনুরোধ চলে
      ...(supportsFallback(model)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    };
    const message = await getClient().beta.messages.stream(params).finalMessage();
    cost = usageCostMicros(message.usage, model);
    if (message.stop_reason === "refusal") throw new AiError("refused");
    if (message.stop_reason === "max_tokens") throw new AiError("too_long");
    const answer = message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .at(-1);
    if (!answer) throw new AiError("invalid", "No text in the answer");
    let data: z.output<S>;
    try {
      data = format.parse(answer) as z.output<S>;
    } catch (error) {
      throw new AiError("invalid", error instanceof Error ? error.message : String(error));
    }
    return { data, costMicros: cost, model: message.model };
  } catch (error) {
    throw toAiError(error);
  } finally {
    await adjustUsage(request.shop.id, "ai", month, cost - reserved);
  }
}
