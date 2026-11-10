import { z } from "@app/tool-sdk";

/**
 * ইমেইলের লেখা, প্রেরকের সেটিংস আর HTML বানানো। এখানে কোনো ডাটাবেস বা নেটওয়ার্ক নেই,
 * তাই অ্যাডমিনের প্রিভিউ আর সার্ভারের পাঠানো দুটোই একই কোড ব্যবহার করে।
 */

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^$|^https:\/\/\S+$/)
  .default("");

export const emailContentSchema = z.object({
  subject: z.string().trim().min(1).max(150),
  preheader: z.string().trim().max(150).default(""),
  heading: z.string().trim().max(120).default(""),
  body: z.string().trim().max(5000).default(""),
  buttonText: z.string().trim().max(40).default(""),
  buttonUrl: httpsUrl,
  imageUrl: httpsUrl,
});
export type EmailContent = z.output<typeof emailContentSchema>;

export const emailSettingsSchema = z.object({
  senderName: z.string().trim().max(60).default(""),
  replyTo: z
    .string()
    .trim()
    .max(254)
    .regex(/^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    .default(""),
  /** আইনে লাগে (CAN-SPAM ইত্যাদি): মার্কেটিং ইমেইলের নিচে ব্যবসার ঠিকানা */
  postalAddress: z.string().trim().max(300).default(""),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#111827"),
});
export type EmailSettings = z.output<typeof emailSettingsSchema>;

export function readEmailSettings(raw: unknown): EmailSettings {
  const parsed = emailSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : emailSettingsSchema.parse({});
}

/* ------------------------------------------------------------------ */
/* স্বয়ংক্রিয় ইমেইল (flow)                                            */
/* ------------------------------------------------------------------ */

export const FLOW_KEYS = ["welcome", "abandoned-checkout", "review-request", "winback"] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];

export const flowContentSchema = emailContentSchema.omit({ buttonUrl: true, imageUrl: true });
export type FlowContent = z.output<typeof flowContentSchema>;

export interface FlowDefinition {
  /** ঘটনার কত মিনিট পরে (মার্চেন্ট বদলাতে পারেন) */
  delayMinutes: number;
  minDelay: number;
  maxDelay: number;
  content: FlowContent;
}

const DAY = 24 * 60;

export const FLOWS: Record<FlowKey, FlowDefinition> = {
  welcome: {
    delayMinutes: 5,
    minDelay: 0,
    maxDelay: 7 * DAY,
    content: {
      subject: "Welcome to {shop}",
      preheader: "Thanks for joining us",
      heading: "Thanks for joining us",
      body: "Hi {first_name},\n\nYou're on the list. We'll let you know about new arrivals and offers.",
      buttonText: "Visit the store",
    },
  },
  "abandoned-checkout": {
    delayMinutes: 60,
    minDelay: 15,
    maxDelay: 7 * DAY,
    content: {
      subject: "You left something behind",
      preheader: "Your cart is saved",
      heading: "Still thinking it over?",
      body: "Hi {first_name},\n\nYour cart at {shop} is saved. You can pick up where you left off.",
      buttonText: "Return to checkout",
    },
  },
  "review-request": {
    delayMinutes: 7 * DAY,
    minDelay: DAY,
    maxDelay: 60 * DAY,
    content: {
      subject: "How was your order from {shop}?",
      preheader: "Your review helps other shoppers",
      heading: "How did we do?",
      body: "Hi {first_name},\n\nWe hope you're enjoying {product}. Would you take a minute to tell other shoppers what you think?",
      buttonText: "Write a review",
    },
  },
  winback: {
    delayMinutes: 60 * DAY,
    minDelay: 14 * DAY,
    maxDelay: 365 * DAY,
    content: {
      subject: "It's been a while",
      preheader: "See what's new at {shop}",
      heading: "We'd love to see you again",
      body: "Hi {first_name},\n\nIt's been a while since your last order. Have a look at what's new at {shop}.",
      buttonText: "See what's new",
    },
  },
};

export function isFlowKey(value: unknown): value is FlowKey {
  return typeof value === "string" && (FLOW_KEYS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* লেখা বসানো ও HTML                                                   */
/* ------------------------------------------------------------------ */

/** "{first_name}" → মান; অজানা নাম যেমন আছে তেমনই থাকে */
export function fillVars(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function fillContent<T extends Record<string, string>>(
  content: T,
  vars: Record<string, string | number>,
): T {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(content)) {
    out[key] = key.endsWith("Url") ? value : fillVars(value, vars);
  }
  return out as T;
}

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export interface EmailFrame {
  shopName: string;
  accent: string;
  postalAddress: string;
  /** মার্কেটিং ইমেইলে বাধ্যতামূলক; লেনদেনের ইমেইলে (যেমন withdrawal-এর প্রাপ্তিস্বীকার) থাকে না */
  unsubscribeUrl?: string;
  /** খোলা গোনার ১x১ ছবি */
  openPixelUrl?: string;
  /** ক্লিক গোনার জন্য লিংক মোড়ানো */
  wrapLink?: (url: string) => string;
  unsubscribeLabel?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** সব ইমেইল ক্লায়েন্টে চলে এমন সরল এক কলামের টেমপ্লেট (টেবিল আর inline style) */
export function renderEmail(content: EmailContent, frame: EmailFrame): RenderedEmail {
  const link = (url: string) => (frame.wrapLink ? frame.wrapLink(url) : url);
  const paragraphs = content.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const unsubscribe = frame.unsubscribeLabel ?? "Unsubscribe";

  const bodyHtml = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#374151">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  const button =
    content.buttonText && content.buttonUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px"><tr><td style="border-radius:8px;background:${frame.accent}"><a href="${escapeHtml(link(content.buttonUrl))}" style="display:inline-block;padding:12px 24px;font-size:16px;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(content.buttonText)}</a></td></tr></table>`
      : "";
  const image = content.imageUrl
    ? `<img src="${escapeHtml(content.imageUrl)}" alt="" width="536" style="display:block;width:100%;max-width:536px;height:auto;border-radius:8px;margin:0 0 20px">`
    : "";
  const footer = [
    escapeHtml(frame.shopName),
    frame.postalAddress ? escapeHtml(frame.postalAddress).replace(/\n/g, "<br>") : "",
    frame.unsubscribeUrl
      ? `<a href="${escapeHtml(frame.unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline">${escapeHtml(unsubscribe)}</a>`
      : "",
  ]
    .filter(Boolean)
    .join("<br>");
  const pixel = frame.openPixelUrl
    ? `<img src="${escapeHtml(frame.openPixelUrl)}" alt="" width="1" height="1" style="display:block;border:0">`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px">
<tr><td style="padding:24px 32px 0;font-size:18px;font-weight:700;color:${frame.accent}">${escapeHtml(frame.shopName)}</td></tr>
<tr><td style="padding:20px 32px 16px">${image}${content.heading ? `<h1 style="margin:0 0 16px;font-size:24px;line-height:32px;color:#111827">${escapeHtml(content.heading)}</h1>` : ""}${bodyHtml}${button}</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td align="center" style="padding:16px 32px;font-size:12px;line-height:18px;color:#6b7280">${footer}</td></tr></table>
${pixel}</td></tr></table></body></html>`;

  const text = [
    content.heading,
    ...paragraphs,
    content.buttonText && content.buttonUrl ? `${content.buttonText}: ${content.buttonUrl}` : "",
    "--",
    frame.shopName,
    frame.postalAddress,
    frame.unsubscribeUrl ? `${unsubscribe}: ${frame.unsubscribeUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject: content.subject, html, text };
}
