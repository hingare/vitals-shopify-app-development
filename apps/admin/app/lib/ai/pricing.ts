/**
 * Claude মডেলের দাম, প্রতি ১০ লাখ টোকেনে ডলার। ১ টোকেন × $X/১০ লাখ = X মাইক্রো-ডলার, তাই
 * খরচ (মাইক্রো-ডলারে) = টোকেন × দাম। নতুন মডেল চালাতে হলে আগে এখানে তার দাম যোগ করুন।
 * cache-এর টোকেন (আমরা cache চালু করি না) ইচ্ছা করে বেশি দামে ধরা হয়, যাতে হিসাব কখনো কম না হয়।
 */
interface Price {
  input: number;
  output: number;
  /** এত টোকেনের বেশি প্রম্পটে দাম বাড়ে */
  long?: { above: number; input: number; output: number };
}

export const MODEL_PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    long: { above: 100_000, input: 0.5, output: 2.5 },
  },
};

/** `fallbacks: "default"` চালু থাকলে অনুরোধ এই মডেলগুলোতেও যেতে পারে (Haiku-র কোনো fallback নেই) */
const FALLBACK_TARGETS: Record<string, string[]> = {
  "claude-opus-5-5": ["claude-opus-5", "claude-opus-4-8"],
  "claude-sonnet-5-5": ["claude-sonnet-5"],
};

export const knownModel = (model: string) => Object.hasOwn(MODEL_PRICES, model);
export const supportsFallback = (model: string) => Object.hasOwn(FALLBACK_TARGETS, model);

/** অচেনা মডেলের দাম তালিকার সবচেয়ে দামিটা ধরে (হিসাব কম হবে না) */
function priceOf(model: string | null | undefined): Price {
  if (model && knownModel(model)) return MODEL_PRICES[model] as Price;
  const all = Object.values(MODEL_PRICES);
  return {
    input: Math.max(...all.map((p) => p.input)),
    output: Math.max(...all.map((p) => p.output)),
  };
}

export interface UsageEntry {
  model?: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

function entryCost(entry: UsageEntry, fallbackModel: string): number {
  const price = priceOf(entry.model ?? fallbackModel);
  const cached = (entry.cache_read_input_tokens ?? 0) + (entry.cache_creation_input_tokens ?? 0);
  const prompt = entry.input_tokens + cached;
  const rate = price.long && prompt > price.long.above ? price.long : price;
  return (
    entry.input_tokens * rate.input + cached * rate.input * 1.25 + entry.output_tokens * rate.output
  );
}

/**
 * একটা উত্তরের আসল খরচ, মাইক্রো-ডলারে (উপরের দিকে গোল)।
 * `usage.iterations` থাকলে প্রতিটা চেষ্টা আলাদা দামে (fallback মডেলের দাম তার নিজের), নইলে মোট usage।
 */
export function usageCostMicros(
  usage: UsageEntry & { iterations?: Array<UsageEntry & { type?: string }> | null },
  model: string,
): number {
  const entries = usage.iterations?.length ? usage.iterations : [usage];
  return Math.ceil(entries.reduce((sum, entry) => sum + entryCost(entry, model), 0));
}

/**
 * কাজের আগে ধরে রাখার মতো সর্বোচ্চ খরচ: প্রম্পট পুরোটা আর `maxTokens` পুরোটা লাগলে যা হয়।
 * fallback চালু থাকলে প্রথম মডেল মাঝপথে থেমে fallback আবার পুরোটা চালাতে পারে, তাই দুটোই যোগ।
 */
export function maxCostMicros(model: string, inputTokens: number, maxTokens: number): number {
  const worst = (m: string) =>
    entryCost({ model: m, input_tokens: inputTokens, output_tokens: maxTokens }, m);
  const fallback = Math.max(0, ...(FALLBACK_TARGETS[model] ?? []).map(worst));
  return Math.ceil(worst(model) + fallback);
}

/** ছবির টোকেন বড় মাপেও এর নিচে থাকে (Claude ছবি ছোট করে নেয়) */
export const IMAGE_TOKENS = 5_000;

/** লেখা থেকে টোকেনের ইচ্ছা করে বেশি অনুমান (ইংরেজিতে ~৪ অক্ষরে ১ টোকেন; নতুন tokenizer-এ বেশি) */
export const estimateTokens = (text: string) => Math.ceil(text.length / 2.5) + 16;
