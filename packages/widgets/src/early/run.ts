/**
 * পাতা আঁকার আগে উইজেট বসানো (early.ts): app embed <head>-এ থাকে, তাই এই কোড চলে থিমের HTML পড়া
 * শুরুর আগেই। MutationObserver-এর ডাক ব্রাউজার পাতা আঁকার আগে আসে, তাই থিমের যে জিনিসের পাশে উইজেট
 * বসবে (Add to cart ফর্ম, চেকআউট বাটন) সেটা পড়া হলেই উইজেট বসে যায়, লেখা পরে নিচে সরে না।
 */

/** একটা কাজ: true ফেরত দিলে শেষ। last = HTML পড়া শেষ (DOMContentLoaded), এটাই শেষ সুযোগ */
export type Job = (last: boolean) => boolean;

export function whileParsing(jobs: Job[]) {
  let pending = jobs;
  const run = (last: boolean) => {
    pending = pending.filter((job) => {
      try {
        return !job(last) && !last;
      } catch {
        return false;
      }
    });
    if (pending.length === 0) observer.disconnect();
  };
  const observer = new MutationObserver(() => run(false));
  if (document.readyState !== "loading") return run(true);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => run(true), { once: true });
  run(false);
}

/** মার্চেন্ট থিমে এই উইজেটের app block বসিয়েছেন, আর সেটা থিমের HTML-এ এসে গেছে */
export const slotReady = (tool: string) =>
  document.querySelector(`[data-app-slot="${tool}"]`) !== null;

/** টুলের ফাইল নিজেই উইজেট বসিয়ে ফেলেছে (early.ts দেরিতে চললে, যাতে দুটো না হয়) */
export const placed = (tool: string) =>
  document.querySelector(`[data-app-widget="${tool}"]`) !== null;

/** উইজেটের জায়গাটা আগেভাগে বসানো, যাতে টুলের ফাইল পরে এসে এটাই ব্যবহার করে */
export function markEarly(host: HTMLElement, tool: string): HTMLElement {
  host.dataset.appEarly = tool;
  return host;
}

/**
 * টুলের ফাইল চালু হলে: পাতা আঁকার আগে বসানো জায়গাটা (না থাকলে null)। মার্চেন্ট থিমে আমাদের
 * app block বসালে উইজেট সেখানে যায়, ব্লকটা HTML-এ ফর্মের পরে থাকলেও।
 */
export function adopt(tool: string): HTMLElement | null {
  const host = document.querySelector<HTMLElement>(`[data-app-early="${tool}"]`);
  const block = document.querySelector<HTMLElement>(`[data-app-slot="${tool}"]`);
  if (host && block && !block.contains(host)) block.appendChild(host);
  return host;
}
