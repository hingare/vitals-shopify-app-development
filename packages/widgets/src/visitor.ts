import { loadPrivacyApi } from "./privacy";

export type VisitorInfo = { email?: string; phone?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** + আর ৭ থেকে ১৫টা অঙ্ক; মাঝে ফাঁকা, ড্যাশ, ডট বা বন্ধনী থাকতে পারে */
const PHONE = /^\+?[\d\s().-]{7,20}$/;

/** "ইমেইল বা ফোন" ঘরের লেখা থেকে কোনটা দেওয়া হয়েছে */
export function contactInfo(value: string): VisitorInfo {
  const text = value.trim();
  return text.includes("@") ? { email: text } : { phone: text };
}

/** শুধু ঠিকঠাক দেখতে ইমেইল আর ফোন রাখা (Shopify ভুল ঠিকানায় error ছোড়ে) */
export function cleanVisitorInfo(info: VisitorInfo): VisitorInfo | null {
  const result: VisitorInfo = {};
  const email = info.email?.trim();
  const phone = info.phone?.trim();
  if (email && email.length <= 254 && EMAIL.test(email)) result.email = email;
  const digits = phone?.replace(/\D/g, "").length ?? 0;
  if (phone && PHONE.test(phone) && digits >= 7 && digits <= 15) result.phone = phone;
  return result.email || result.phone ? result : null;
}

/**
 * ভিজিটর নিজে কোনো ফর্মে যে ইমেইল বা ফোন দিলেন, সেটা Shopify-র Visitor API-তে জানানো, যাতে মার্চেন্ট
 * Shopify-তেই বুঝতে পারেন কে এসেছিলেন (Built for Shopify-র শর্ত)। ফর্ম সফলভাবে জমা হওয়ার পরে ডাকুন।
 * ভিজিটর অ্যানালিটিক্সে সম্মতি না দিলে কিছু পাঠানো হয় না, আর কোনো ভুলে ফর্মের কাজ আটকায় না।
 */
export async function identifyVisitor(info: VisitorInfo): Promise<void> {
  const payload = cleanVisitorInfo(info);
  if (!payload) return;
  try {
    const privacy = await loadPrivacyApi();
    if (privacy?.analyticsProcessingAllowed && !privacy.analyticsProcessingAllowed()) return;
    const appId = window.__APP_CONFIG__?.appId;
    window.Shopify?.analytics?.visitor?.(payload, appId ? { appId } : {});
  } catch {
    // Shopify ভুল payload-এ error ছোড়ে; ক্রেতার কাজ তাতে থামে না
  }
}
