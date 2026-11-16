/**
 * AI কাজের ত্রুটির ধরন। ডাটাবেসে (AiGeneration.error) শুধু ধরনটা থাকে, আর মার্চেন্ট দেখেন
 * `ai.error.<ধরন>` লেখা, তাই ভেতরের বার্তা (যেমন API-র উত্তর) কখনো অ্যাডমিনে যায় না।
 */
export const AI_ERROR_CODES = [
  "not_configured",
  "plan",
  "budget",
  "busy",
  "refused",
  "too_long",
  "invalid",
  "not_found",
  "changed",
  "failed",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "AiError";
  }

  /** একটু পরে আবার চেষ্টা করলে কাজ হতে পারে */
  get retryable() {
    return this.code === "busy";
  }
}

export const asAiError = (error: unknown): AiError =>
  error instanceof AiError
    ? error
    : new AiError("failed", error instanceof Error ? error.message : String(error));

export const isAiErrorCode = (value: unknown): value is AiErrorCode =>
  typeof value === "string" && (AI_ERROR_CODES as readonly string[]).includes(value);
