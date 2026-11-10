/**
 * ইমেইলের HTML বানানো। এখানে কোনো ডাটাবেস, নেটওয়ার্ক বা schema লাইব্রেরি নেই,
 * তাই অ্যাডমিনের প্রিভিউ (ব্রাউজারে) আর সার্ভারের পাঠানো দুটোই একই কোড ব্যবহার করে।
 */
export const FLOW_KEYS = ["welcome", "abandoned-checkout", "review-request", "winback"] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];

export type EmailContent = {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  buttonText: string;
  buttonUrl: string;
  imageUrl: string;
};

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
