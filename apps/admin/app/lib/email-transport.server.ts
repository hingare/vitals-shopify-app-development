import { createHmac, createVerify, timingSafeEqual } from "node:crypto";
import { timedFetch } from "@app/integrations";
import { signV4 } from "./sigv4";

/**
 * ইমেইল পাঠানোর পথ। সার্ভারের .env ঠিক করে কোন সার্ভিস:
 *   EMAIL_PROVIDER=resend  + RESEND_API_KEY
 *   EMAIL_PROVIDER=ses     + AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SES_REGION (+ ঐচ্ছিক SES_CONFIGURATION_SET)
 *   EMAIL_FROM=mail@your-sending-domain.com (প্রোভাইডারে যাচাই করা ডোমেইনের ঠিকানা)
 * কিছু না দিলে "none": কোনো ইমেইল যায় না, আর অ্যাডমিন সেটা স্পষ্ট করে বলে।
 * নতুন সার্ভিস যোগ করতে send-এ একটা case আর (চাইলে) ঘটনার parser যোগ করুন।
 */
export type EmailProvider = "none" | "resend" | "ses";

export function emailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  if (!env.EMAIL_FROM) return "none";
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) return "resend";
  if (env.EMAIL_PROVIDER === "ses" && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    return "ses";
  }
  return "none";
}

export interface OutgoingEmail {
  /** প্রেরকের দেখানো নাম (স্টোরের নাম); ঠিকানা সবসময় EMAIL_FROM */
  fromName: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
  /** true হলে আবার চেষ্টা করে লাভ নেই (ভুল ঠিকানা, বাতিল চাবি) */
  permanent?: boolean;
}

type FetchFn = typeof fetch;

/** নামের ভেতরের উদ্ধৃতি চিহ্ন বা নতুন লাইন header ভেঙে দিতে পারে, তাই সরিয়ে দিই */
export function fromHeader(name: string, address: string): string {
  const clean = name.replace(/["\\\r\n<>]/g, "").trim();
  return clean ? `"${clean}" <${address}>` : address;
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  try {
    const json = JSON.parse(body) as { message?: string; Message?: string; name?: string };
    return `${res.status} ${json.message ?? json.Message ?? json.name ?? ""}`.trim();
  } catch {
    return `${res.status} ${body.slice(0, 200)}`.trim();
  }
}

const transient = (status: number) => status === 429 || status >= 500;

async function sendResend(mail: OutgoingEmail, env: NodeJS.ProcessEnv, fetchFn: FetchFn) {
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromHeader(mail.fromName, env.EMAIL_FROM ?? ""),
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      ...(mail.headers ? { headers: mail.headers } : {}),
    }),
  });
  if (!res.ok) {
    return { ok: false, error: await readError(res), permanent: !transient(res.status) };
  }
  const json = (await res.json()) as { id?: string };
  return { ok: true, providerId: json.id };
}

async function sendSes(mail: OutgoingEmail, env: NodeJS.ProcessEnv, fetchFn: FetchFn) {
  const region = env.SES_REGION || env.AWS_REGION || "us-east-1";
  const url = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  const body = JSON.stringify({
    FromEmailAddress: fromHeader(mail.fromName, env.EMAIL_FROM ?? ""),
    Destination: { ToAddresses: [mail.to] },
    ...(mail.replyTo ? { ReplyToAddresses: [mail.replyTo] } : {}),
    ...(env.SES_CONFIGURATION_SET ? { ConfigurationSetName: env.SES_CONFIGURATION_SET } : {}),
    Content: {
      Simple: {
        Subject: { Data: mail.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: mail.html, Charset: "UTF-8" },
          Text: { Data: mail.text, Charset: "UTF-8" },
        },
        ...(mail.headers
          ? {
              Headers: Object.entries(mail.headers).map(([Name, Value]) => ({ Name, Value })),
            }
          : {}),
      },
    },
  });
  const headers = signV4({
    method: "POST",
    url,
    headers: { "content-type": "application/json" },
    body,
    region,
    service: "ses",
    accessKeyId: env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "",
    sessionToken: env.AWS_SESSION_TOKEN,
  });
  const res = await fetchFn(url, { method: "POST", headers, body });
  if (!res.ok) {
    return { ok: false, error: await readError(res), permanent: !transient(res.status) };
  }
  const json = (await res.json()) as { MessageId?: string };
  return { ok: true, providerId: json.MessageId };
}

export async function sendEmail(
  mail: OutgoingEmail,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: FetchFn = timedFetch,
): Promise<SendResult> {
  const provider = emailProvider(env);
  try {
    if (provider === "resend") return await sendResend(mail, env, fetchFn);
    if (provider === "ses") return await sendSes(mail, env, fetchFn);
    return { ok: false, error: "email_not_configured", permanent: true };
  } catch (error) {
    // নেটওয়ার্ক সমস্যা: পরে আবার চেষ্টা হবে
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/* ------------------------------------------------------------------ */
/* প্রোভাইডারের ঘটনা (পৌঁছেছে, ফেরত এসেছে, স্প্যাম অভিযোগ)              */
/* ------------------------------------------------------------------ */

export type DeliveryEventType = "delivered" | "bounced" | "complained";
export interface DeliveryEvent {
  type: DeliveryEventType;
  providerId: string;
  /** স্থায়ী bounce বা অভিযোগ হলে এই ঠিকানায় আর পাঠানো হয় না */
  recipients: string[];
}

/** Resend-এর webhook (Svix সই): header-এর সই ঠিক হলে true */
export function verifySvix(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now(),
): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const age = Math.abs(now / 1000 - Number(headers.timestamp));
  if (!Number.isFinite(age) || age > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${body}`)
    .digest();
  return headers.signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export function parseResendEvent(body: unknown): DeliveryEvent | null {
  const event = (body ?? {}) as { type?: string; data?: { email_id?: string; to?: unknown } };
  const type =
    event.type === "email.delivered"
      ? "delivered"
      : event.type === "email.bounced"
        ? "bounced"
        : event.type === "email.complained"
          ? "complained"
          : null;
  const providerId = event.data?.email_id;
  if (!type || !providerId) return null;
  const to = event.data?.to;
  const recipients = (Array.isArray(to) ? to : [to]).filter(
    (v): v is string => typeof v === "string",
  );
  return { type, providerId, recipients };
}

export interface SnsMessage {
  Type?: string;
  MessageId?: string;
  TopicArn?: string;
  Subject?: string;
  Message?: string;
  Timestamp?: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
  SubscribeURL?: string;
  Token?: string;
}

/** সার্টিফিকেট বা subscribe লিংক অবশ্যই Amazon SNS-এর নিজের ঠিকানা হতে হবে */
export function isSnsUrl(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.host);
  } catch {
    return false;
  }
}

export function snsStringToSign(msg: SnsMessage): string {
  const fields =
    msg.Type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  let out = "";
  for (const field of fields) {
    const value = msg[field as keyof SnsMessage];
    if (value === undefined || value === null) continue;
    out += `${field}\n${value}\n`;
  }
  return out;
}

/** Amazon SNS-এর সই যাচাই (সার্টিফিকেট Amazon-এর সার্ভার থেকে আনা হয়) */
export async function verifySns(msg: SnsMessage, fetchFn: FetchFn = timedFetch): Promise<boolean> {
  if (!msg.Signature || !isSnsUrl(msg.SigningCertURL)) return false;
  try {
    const res = await fetchFn(msg.SigningCertURL as string);
    if (!res.ok) return false;
    const cert = await res.text();
    const verifier = createVerify(msg.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1");
    verifier.update(snsStringToSign(msg), "utf8");
    return verifier.verify(cert, msg.Signature, "base64");
  } catch {
    return false;
  }
}

/** SES-এর ঘটনা (SNS Notification-এর Message অংশ) */
export function parseSesEvent(message: string | undefined): DeliveryEvent | null {
  let event: {
    eventType?: string;
    notificationType?: string;
    mail?: { messageId?: string; destination?: string[] };
    bounce?: { bounceType?: string; bouncedRecipients?: Array<{ emailAddress?: string }> };
    complaint?: { complainedRecipients?: Array<{ emailAddress?: string }> };
  };
  try {
    event = JSON.parse(message ?? "") as typeof event;
  } catch {
    return null;
  }
  const kind = event.eventType ?? event.notificationType;
  const providerId = event.mail?.messageId;
  if (!providerId) return null;
  const emails = (list?: Array<{ emailAddress?: string }>) =>
    (list ?? []).map((r) => r.emailAddress).filter((v): v is string => typeof v === "string");
  if (kind === "Delivery") {
    return { type: "delivered", providerId, recipients: event.mail?.destination ?? [] };
  }
  // অস্থায়ী bounce (ইনবক্স ভরা ইত্যাদি) ধরা হয় না: SES নিজেই আবার চেষ্টা করে
  if (kind === "Bounce" && event.bounce?.bounceType === "Permanent") {
    return { type: "bounced", providerId, recipients: emails(event.bounce.bouncedRecipients) };
  }
  if (kind === "Complaint") {
    return {
      type: "complained",
      providerId,
      recipients: emails(event.complaint?.complainedRecipients),
    };
  }
  return null;
}
