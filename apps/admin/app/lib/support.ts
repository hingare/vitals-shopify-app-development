import type { TFunction } from "@app/i18n";

/**
 * মার্চেন্ট সাপোর্টের যে অংশ ব্রাউজার আর সার্ভার দুজনেরই লাগে: লেখার সীমা, টিকিটের অবস্থা,
 * উত্তরের সময়ের লেখা, আর সাপোর্ট সহকারীর উত্তর থেকে নিরাপদ লিংক আর বোল্ড বের করা।
 * সার্ভারের অংশ support.server.ts আর support-ai.server.ts-এ।
 */

export const SUBJECT_MAX = 150;
export const MESSAGE_MAX = 5000;
/** সাপোর্ট সহকারীকে একবারে করা প্রশ্নের দৈর্ঘ্য */
export const QUESTION_MAX = 1000;
/** সহকারীর কাছে যায় কথোপকথনের শেষ কতগুলো বার্তা (প্রশ্ন আর উত্তর মিলিয়ে) */
export const ASK_TURNS = 10;

/** "open": আমাদের উত্তরের অপেক্ষায়, "answered": মার্চেন্টের অপেক্ষায়, "closed": শেষ */
export type TicketStatus = "open" | "answered" | "closed";

export type AskError = "invalid" | "tooLong" | "busy" | "limit" | "unavailable" | "failed";

export interface AskMessage {
  role: "user" | "assistant";
  content: string;
}

/** Help পাতার "Ask" (app.help.ask) যা ফেরত দেয় */
export type AskResult = { ok: true; answer: string } | { ok: false; error: AskError };

export const isTicketStatus = (value: unknown): value is TicketStatus =>
  value === "open" || value === "answered" || value === "closed";

/** মিনিট থেকে "১ ঘণ্টার মধ্যে", "৪ ঘণ্টার মধ্যে", "২ দিনের মধ্যে" (উপরের দিকে রাউন্ড করা) */
export function replyTimeLabel(t: TFunction, minutes: number): string {
  if (minutes <= 60) return t("support.within.hour");
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return t("support.within.hours", { n: hours });
  return t("support.within.days", { n: Math.ceil(hours / 24) });
}

/** সময়ের দৈর্ঘ্য: "৪০ মিনিট", "৩ ঘণ্টা", "২ দিন" (নিচের দিকে রাউন্ড করা) */
export function durationLabel(t: TFunction, minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  if (whole < 60) return t("support.duration.minutes", { n: whole });
  if (whole < 1440) return t("support.duration.hours", { n: Math.floor(whole / 60) });
  return t("support.duration.days", { n: Math.floor(whole / 1440) });
}

export type AnswerPart =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; text: string; href: string };

/** লিংক শুধু আমাদের সাহায্য কেন্দ্রের সাইটে; অন্য কোনো ঠিকানা লেখা হিসেবেই দেখায় */
export function isHelpLink(href: string, siteUrl: string): boolean {
  try {
    const url = new URL(href);
    const site = new URL(siteUrl);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === site.origin;
  } catch {
    return false;
  }
}

const INLINE = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function lineParts(line: string, siteUrl: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: "text", text: line.slice(last, index) });
    const [, bold, label, href] = match;
    if (bold !== undefined) parts.push({ kind: "bold", text: bold });
    else if (label !== undefined && href !== undefined && isHelpLink(href, siteUrl)) {
      parts.push({ kind: "link", text: label, href });
    } else if (label !== undefined) parts.push({ kind: "text", text: label });
    last = index + match[0].length;
  }
  if (last < line.length) parts.push({ kind: "text", text: line.slice(last) });
  return parts;
}

/**
 * সহকারীর উত্তর (সামান্য Markdown: **বোল্ড**, [লিংক](ঠিকানা), তালিকা) → লাইন আর অংশ।
 * HTML হিসেবে কিছুই বসে না: React সব লেখা নিজেই নিরাপদ করে, আর লিংক শুধু সাহায্য কেন্দ্রের।
 */
export function answerLines(answer: string, siteUrl: string): AnswerPart[][] {
  return answer
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s*$/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^[-*•]\s+/, "• "))
    .map((line) => lineParts(line, siteUrl));
}
