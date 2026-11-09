/**
 * উইজেটের অ্যানালিটিক্স: ইভেন্ট জমিয়ে একসাথে sendBeacon দিয়ে পাঠায় (পেজ ধীর করে না)।
 * কোনো টুল থেকে কার্টে যোগ হলে cart attribute-এ টুলের নাম রাখে,
 * যাতে অর্ডার হলে কোন টুল বিক্রি আনল তা জানা যায়।
 */
type EventType = "view" | "click" | "add_to_cart";

const ENDPOINT = "/apps/app-tools/events";
const ATTRIBUTE = "_app_tools";
const STORAGE_KEY = "app_tools_attr";
const queue: Array<{ toolId: string; type: EventType }> = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (queue.length === 0) return;
  const body = JSON.stringify({ events: queue.splice(0, queue.length) });
  if (!navigator.sendBeacon?.(ENDPOINT, body)) {
    fetch(ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => {});
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

export function track(toolId: string, type: EventType) {
  queue.push({ toolId, type });
  if (!timer) timer = setTimeout(flush, 3000);
}

/** কার্টে যোগের পর ডাকুন: এই টুলকে অর্ডারের কৃতিত্ব দেওয়ার জন্য */
export function attribute(toolId: string): Promise<void> {
  let tools: string[] = [];
  try {
    tools = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]") as string[];
  } catch {
    tools = [];
  }
  if (tools.includes(toolId)) return Promise.resolve();
  tools.push(toolId);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tools));
  } catch {
    // private mode: attribution still sent below
  }
  return fetch("/cart/update.js", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attributes: { [ATTRIBUTE]: tools.join(",") } }),
  }).then(
    () => undefined,
    () => undefined,
  );
}
