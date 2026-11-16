import { record } from "@rrweb/record";

/**
 * রেকর্ডারের ভারী অংশ (rrweb)। শুধু রেকর্ডের জন্য বাছাই হওয়া আর অ্যানালিটিক্সে রাজি ভিজিটরের ব্রাউজারে,
 * পেজ লোড শেষ হওয়ার পরে আলাদা ফাইল থেকে আসে; বাকি সবার কাছে এই ফাইল কখনো যায় না।
 */
export interface RecordedEvent {
  type: number;
  timestamp: number;
  data?: unknown;
}

export function startRecorder(
  emit: (event: RecordedEvent) => void,
  maskTextSelector: string,
): () => void {
  const stop = record({
    emit: (event) => emit(event as RecordedEvent),
    // ক্রেতা যা লেখেন (ইমেইল, ঠিকানা, পাসওয়ার্ড) কখনো রেকর্ডে যায় না
    maskAllInputs: true,
    maskTextSelector,
    blockSelector: "[data-app-block], .app-block",
    // স্ক্রিপ্ট, মন্তব্য আর head-এর অপ্রয়োজনীয় অংশ বাদ: রেকর্ড ছোট থাকে
    slimDOMOptions: "all",
    // থিমের CSS প্রতিবার রেকর্ডে কপি না করে লিংক থাকে (রিপ্লের সময় স্টোর থেকেই আসে)
    inlineStylesheet: false,
    recordCanvas: false,
    collectFonts: false,
    inlineImages: false,
    recordCrossOriginIframes: false,
    sampling: { scroll: 150, media: 800, input: "last" },
    // কোনো এক জায়গায় ভুল হলে পুরো রেকর্ড থামে না, স্টোরও ভাঙে না
    errorHandler: () => true,
  });
  return () => stop?.();
}
