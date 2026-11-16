import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatError } from "@/lib/chat-limits";
import { DailyLimiter, WindowLimiter } from "@/lib/rate-limit";
import { supportChatEnabled } from "@/lib/site";
import {
  MAX_ANSWER_TOKENS,
  parseChatRequest,
  supportModel,
  supportSystemPrompt,
} from "@/lib/support-chat";

export const dynamic = "force-dynamic";

/** Questions one visitor can ask in 10 minutes */
const perVisitor = new WindowLimiter(10, 10 * 60_000);
/** Questions all visitors together can ask in a day, so a flood can't run up the bill */
const perDay = new DailyLimiter(Number(process.env.SUPPORT_CHAT_DAILY_LIMIT) || 300);

let client: Anthropic | null = null;

function fail(error: ChatError, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/** The visitor's IP address, hashed: it's only used to count their questions */
function visitorKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(ip).digest("hex");
}

function errorStatus(error: unknown): [ChatError, number] {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return ["unavailable", 503];
  }
  if (
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    return ["busy", 503];
  }
  return ["failed", 502];
}

/**
 * Answers a question as plain text, streamed as it's written. Errors before the answer starts
 * come back as JSON with a status code; an answer that breaks off ends the stream with an error.
 */
export async function POST(request: Request) {
  if (!supportChatEnabled()) return fail("unavailable", 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid", 400);
  }
  const parsed = parseChatRequest(body);
  if (!parsed.ok) return fail(parsed.error, parsed.error === "tooLong" ? 413 : 400);

  if (!perVisitor.take(visitorKey(request))) return fail("busy", 429);
  if (!perDay.take()) return fail("unavailable", 503);

  client ??= new Anthropic({ timeout: 60_000 });
  const stream = client.messages.stream(
    {
      model: supportModel(),
      max_tokens: MAX_ANSWER_TOKENS,
      system: [
        { type: "text", text: await supportSystemPrompt(), cache_control: { type: "ephemeral" } },
      ],
      messages: parsed.messages,
      output_config: { effort: "low" },
    },
    { signal: request.signal },
  );

  // Text can arrive before the response below is returned; keep it until the stream is ready
  const early: string[] = [];
  let push: ((text: string) => void) | null = null;
  stream.on("text", (delta) => (push ? push(delta) : early.push(delta)));

  try {
    await stream.emitted("connect");
  } catch (error) {
    const [code, status] = errorStatus(error);
    return fail(code, status);
  }

  const encoder = new TextEncoder();
  const answer = new ReadableStream<Uint8Array>({
    start(controller) {
      let wrote = false;
      push = (delta) => {
        wrote = true;
        controller.enqueue(encoder.encode(delta));
      };
      early.splice(0).forEach(push);
      stream.finalMessage().then(
        (message) => {
          // A declined or empty answer is shown as an error, not as half a sentence
          if (!wrote || message.stop_reason === "refusal") controller.error(new Error("no answer"));
          else controller.close();
        },
        (error: unknown) => controller.error(error),
      );
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(answer, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
