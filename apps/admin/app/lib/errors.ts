/**
 * অ্যাপের ত্রুটির খাতার যে অংশ ব্রাউজার আর সার্ভার দুজনেরই লাগে: ত্রুটির উৎস, আর অ্যাডমিন পাতায় ব্রাউজারে
 * কোড ভাঙলে সেই খবর সার্ভারে পাঠানো। সার্ভারের অংশ errors.server.ts আর error-alerts.server.ts-এ।
 */

export const ERROR_SOURCES = ["server", "job", "webhook", "admin"] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];

export const isErrorSource = (value: unknown): value is ErrorSource =>
  ERROR_SOURCES.includes(value as ErrorSource);

/** উৎসের নামের লেখা ("Background job" ইত্যাদি) */
export const sourceKey = (source: string) =>
  `deskErrors.source.${isErrorSource(source) ? source : "server"}` as const;

/** ব্রাউজার থেকে পাঠানো একটা খবরের সর্বোচ্চ আকার (বাইট) */
export const CLIENT_REPORT_MAX = 16 * 1024;
const REPORTS_PER_PAGE = 5;

const reported = new WeakSet<object>();
let reportsLeft = REPORTS_PER_PAGE;

/**
 * অ্যাডমিনে ব্রাউজারে কোড ভাঙলে সার্ভারের খাতায় পাঠানো (/app/errors)। শুধু আমাদের নিজের কোডের ত্রুটি যায়:
 * সার্ভারের ত্রুটি ব্রাউজারে আসে "Unexpected Server Error" হয়ে বা সার্ভারের ফাইলের ঠিকানা নিয়ে (সেগুলো সার্ভারেই
 * লেখা হয়েছে), আর অন্য জায়গার স্ক্রিপ্টের (যেমন Shopify-র CDN) ত্রুটির ঠিকানায় আমাদের সাইট থাকে না।
 * একই ত্রুটি একবারই, আর একবার পাতা খোলায় সর্বোচ্চ ৫টা। পাঠাতে না পারলে চুপচাপ বাদ।
 */
export function reportClientError(error: unknown) {
  if (typeof window === "undefined" || !(error instanceof Error) || reported.has(error)) return;
  reported.add(error);
  const stack = error.stack ?? "";
  if (reportsLeft <= 0 || error.message === "Unexpected Server Error") return;
  if (!stack.includes(window.location.origin)) return;
  reportsLeft--;
  const body = JSON.stringify({
    name: error.name.slice(0, 100),
    message: error.message.slice(0, 1000),
    stack: stack.slice(0, 4000),
    path: window.location.pathname.slice(0, 200),
  });
  // App Bridge নিজেই fetch-এ সেশন টোকেন জুড়ে দেয়, তাই সার্ভার জানে কোন স্টোর
  void fetch("/app/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => undefined);
}
