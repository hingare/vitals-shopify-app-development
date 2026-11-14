import { AiError } from "../errors";

/**
 * fal.ai-এর queue API (ছবি আর ভিডিওর AI মডেল এখানে চলে)। SDK নয়, শুধু চারটা HTTP ডাক:
 *   জমা (POST queue.fal.run/<মডেল>), অবস্থা, ফল আর বাতিল (জমার উত্তরে আসা URL দিয়ে)।
 * চাবি .env-এর FAL_KEY থেকে। কাজ শেষ হলে ফলের ফাইল আমরা নিজের স্টোরেজে নিয়ে আসি, তাই fal-কে বলা হয়
 * তাদের কপি এক দিন পরে মুছে দিতে।
 * fal ব্যর্থ অনুরোধের টাকা নেয় কিনা সবসময় নিশ্চিত নয়, তাই টাকা ফেরত (refund) শুধু তখনই, যখন নিশ্চিত যে
 * কাজটা হয়নি (জমা প্রত্যাখ্যাত, লাইনে থাকতেই বাতিল, বা fal-এর নিজের সার্ভারের ত্রুটি)। হিসাব কখনো কম হয় না।
 */
const QUEUE_BASE = "https://queue.fal.run";

/** fal-এর নিজের সার্ভারের ত্রুটি: এগুলোর টাকা নেওয়া হয় না (fal-এর ডক অনুযায়ী) */
const INFRA_ERRORS = new Set([
  "request_timeout",
  "startup_timeout",
  "runner_scheduling_failure",
  "runner_connection_timeout",
  "runner_disconnected",
  "runner_connection_refused",
  "runner_connection_error",
  "runner_incomplete_response",
  "runner_server_error",
  "internal_error",
  "client_cancelled",
]);

export const isFreeFailure = (errorType: string | null | undefined) =>
  Boolean(errorType && INFRA_ERRORS.has(errorType));

type FetchFn = typeof fetch;
let fetchImpl: FetchFn | null = null;

/** টেস্টে নকল fetch বসাতে (null দিলে আবার আসলটা) */
export function setFalFetchForTests(fn: FetchFn | null) {
  fetchImpl = fn;
}

export const falConfigured = () => Boolean(fetchImpl ?? process.env.FAL_KEY?.trim());

/**
 * fal-এর ডাকের ত্রুটি। `rejected`: fal অনুরোধটা নেয়নি বলে নিশ্চিত (HTTP উত্তর এসেছে, কাজ শুরু হয়নি)।
 * নেটওয়ার্ক কেটে গেলে বা সময় ফুরালে নিশ্চিত নয়, তাই rejected নয়।
 */
export class FalError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly rejected: boolean,
    readonly errorType: string | null = null,
  ) {
    super(message);
    this.name = "FalError";
  }
}

/** সংযোগই হয়নি (অনুরোধ fal-এ পৌঁছায়নি), তাই নিশ্চিতভাবে নেওয়া হয়নি */
const CONNECT_ERRORS = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const errorCode = (error: unknown): string | null => {
  const cause =
    error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === "string" ? cause.code : null;
};

async function call(url: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const key = process.env.FAL_KEY?.trim() ?? "";
  if (!fetchImpl && !key) throw new AiError("not_configured", "FAL_KEY is not set");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Key ${key}`);
  try {
    return await (fetchImpl ?? fetch)(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
  } catch (error) {
    const code = errorCode(error);
    throw new FalError(
      error instanceof Error ? `${error.message}${code ? ` (${code})` : ""}` : String(error),
      null,
      Boolean(code && CONNECT_ERRORS.has(code)),
    );
  }
}

async function readError(res: Response): Promise<FalError> {
  const text = await res.text().catch(() => "");
  let detail = text.slice(0, 500);
  let errorType = res.headers.get("x-fal-error-type");
  try {
    const json = JSON.parse(text) as { detail?: unknown; error_type?: string };
    if (typeof json.detail === "string") detail = json.detail;
    else if (json.detail !== undefined) detail = JSON.stringify(json.detail).slice(0, 500);
    errorType = json.error_type ?? errorType;
  } catch {
    // উত্তর JSON না হলে লেখাটাই থাকে
  }
  return new FalError(`fal ${res.status}: ${detail}`, res.status, true, errorType);
}

/** fal-এর ত্রুটি থেকে মার্চেন্টকে দেখানোর মতো AI ত্রুটি */
export function falAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (!(error instanceof FalError)) {
    return new AiError("failed", error instanceof Error ? error.message : String(error));
  }
  if (error.status === 401 || error.status === 403)
    return new AiError("not_configured", error.message);
  if (error.status === null || error.status === 429 || error.status >= 500) {
    return new AiError("busy", error.message);
  }
  // নিরাপত্তার কারণে মডেল ছবি বা লেখা নেয়নি
  if (/nsfw|safety|policy|moderat|flagged|inappropriate|content.?filter/i.test(error.message)) {
    return new AiError("refused", error.message);
  }
  return new AiError(error.status === 404 ? "not_found" : "failed", error.message);
}

export interface FalRequest {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
}

const isHttps = (value: unknown): value is string =>
  typeof value === "string" && /^https:\/\/[^/]*\.fal\.(run|ai)\//.test(value);

/** কাজ জমা দেয়। ফলের ফাইল fal এক দিন রাখে (আমরা তার আগেই নিজের স্টোরেজে আনি)। */
export async function falSubmit(
  model: string,
  input: Record<string, unknown>,
): Promise<FalRequest> {
  const res = await call(`${QUEUE_BASE}/${model}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-fal-object-lifecycle-preference": JSON.stringify({ expiration_duration_seconds: 86_400 }),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const request = {
    requestId: String(json?.request_id ?? ""),
    statusUrl: json?.status_url,
    responseUrl: json?.response_url,
    cancelUrl: json?.cancel_url,
  };
  if (
    !request.requestId ||
    !isHttps(request.statusUrl) ||
    !isHttps(request.responseUrl) ||
    !isHttps(request.cancelUrl)
  ) {
    // অনুরোধ নেওয়া হয়েছে কিনা বোঝা যায় না, তাই rejected নয়
    throw new FalError("fal: unexpected submit response", res.status, false);
  }
  return request as FalRequest;
}

export type FalStatus =
  | { state: "waiting"; position: number | null }
  | { state: "done"; error: string | null; errorType: string | null };

export async function falStatus(statusUrl: string): Promise<FalStatus> {
  const res = await call(statusUrl, { method: "GET" });
  if (!res.ok) throw await readError(res);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (json.status === "COMPLETED") {
    return {
      state: "done",
      error: typeof json.error === "string" && json.error ? json.error : null,
      errorType: typeof json.error_type === "string" ? json.error_type : null,
    };
  }
  if (json.status === "IN_QUEUE" || json.status === "IN_PROGRESS") {
    const position = typeof json.queue_position === "number" ? json.queue_position : null;
    return { state: "waiting", position };
  }
  throw new FalError(`fal: unknown status ${String(json.status)}`, res.status, false);
}

export async function falResult(responseUrl: string): Promise<unknown> {
  const res = await call(responseUrl, { method: "GET", timeoutMs: 60_000 });
  if (!res.ok) throw await readError(res);
  return res.json();
}

/**
 * কাজ বাতিল: "removed" = লাইনেই ছিল, শুরু হয়নি (টাকা লাগে না); "requested" = চলছিল, শেষও হয়ে যেতে পারে;
 * "finished" = আগেই শেষ; "unknown" = উত্তর বোঝা গেল না।
 */
export async function falCancel(
  cancelUrl: string,
): Promise<"removed" | "requested" | "finished" | "unknown"> {
  const res = await call(cancelUrl, { method: "PUT" });
  const json = (await res.json().catch(() => ({}))) as { status?: string };
  if (res.status === 200 && json.status === "OK") return "removed";
  if (res.status === 202) return "requested";
  if (json.status === "ALREADY_COMPLETED") return "finished";
  return "unknown";
}
