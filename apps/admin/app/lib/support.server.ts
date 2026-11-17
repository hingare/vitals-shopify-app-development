import { randomUUID } from "node:crypto";
import { brand } from "@app/brand";
import { createT, resolveLocale } from "@app/i18n";
import db from "../db.server";
import { renderEmail } from "./email-render";
import { emailProvider, sendEmail } from "./email-transport.server";
import { enqueueJob, registerJob } from "./queue.server";
import { allowRequest } from "./rate-limit.server";
import { MESSAGE_MAX, SUBJECT_MAX, type TicketStatus } from "./support";
import { cleanEmail } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * মার্চেন্ট সাপোর্ট: অ্যাপের Help পাতা থেকে টিকিট, আর অ্যাপের মালিকের সাপোর্ট ডেস্ক থেকে উত্তর।
 *
 * সাপোর্ট ডেস্ক অ্যাপেরই একটা পাতা (/app/desk), শুধু SUPPORT_DESK_SHOPS-এ লেখা স্টোরে খোলে। তাই আলাদা
 * পাসওয়ার্ড নেই: Shopify-র লগইনই পাহারা। সেই স্টোরে অ্যাপটা যেন শুধু মালিক খুলতে পারেন (Shopify-তে
 * স্টাফের অ্যাপ অনুমতি দিয়ে), কারণ ডেস্কে সব মার্চেন্টের টিকিট দেখা যায়।
 *
 * নতুন টিকিট বা মার্চেন্টের উত্তর এলে সাপোর্টের ইনবক্সে (SUPPORT_INBOX) ইমেইল যায়; আমাদের উত্তর গেলে
 * মার্চেন্টের দেওয়া ঠিকানায়। এই ইমেইলগুলো অ্যাপের নিজের নামে যায়, মার্চেন্টের মাসিক ইমেইলের হিসাবে পড়ে না।
 */

/** একসাথে খোলা টিকিট (উত্তরের অপেক্ষায় বা উত্তর পাওয়া) এক স্টোরে এর বেশি নয় */
const MAX_OPEN = 5;
/** এক স্টোর থেকে ২৪ ঘণ্টায় নতুন টিকিট */
const MAX_PER_DAY = 10;
const MAX_MESSAGES = 100;
/** উত্তর দেওয়ার পরে মার্চেন্ট এত দিন কিছু না লিখলে টিকিট নিজে থেকে বন্ধ হয় */
const CLOSE_AFTER_DAYS = 14;
/** শেষ বার্তার এক বছর পরে টিকিট মুছে যায় (স্টোর অ্যাপ সরালে shop/redact-এ আগেই মোছে) */
const KEEP_DAYS = 365;
/** "সাধারণত কত সময়ে উত্তর দিই": শেষ ৩০ দিনের টিকিট, অন্তত ৫টা উত্তর থাকলে; না হলে লক্ষ্যটাই দেখায় */
const STATS_DAYS = 30;
const MIN_SAMPLES = 5;
const DEFAULT_TARGET_HOURS = 24;
const DAY_MS = 86_400_000;

export type TicketError =
  | "invalid_email"
  | "invalid_subject"
  | "invalid_body"
  | "too_many_open"
  | "too_many_today"
  | "not_found"
  | "full"
  | "busy";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: TicketError };

/* ------------------------------------------------------------------ */
/* লেখা যাচাই                                                         */
/* ------------------------------------------------------------------ */

/** বার্তা: নিয়ন্ত্রণ-অক্ষর বাদ, তিনের বেশি ফাঁকা লাইন একটায়; খালি বা খুব লম্বা হলে null */
export function cleanBody(value: unknown, max = MESSAGE_MAX): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text && text.length <= max ? text : null;
}

/** বিষয়: এক লাইনে (ইমেইলের Subject-এ যায়, তাই নতুন লাইন থাকতে পারে না) */
export function cleanSubject(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text && text.length <= SUBJECT_MAX ? text : null;
}

/* ------------------------------------------------------------------ */
/* মার্চেন্টের Help পাতা                                               */
/* ------------------------------------------------------------------ */

export async function createTicket(
  shopId: string,
  input: { email?: unknown; subject?: unknown; body?: unknown },
  now = new Date(),
): Promise<Result<{ id: string }>> {
  const email = cleanEmail(input.email);
  if (!email) return { ok: false, error: "invalid_email" };
  const subject = cleanSubject(input.subject);
  if (!subject) return { ok: false, error: "invalid_subject" };
  const body = cleanBody(input.body);
  if (!body) return { ok: false, error: "invalid_body" };

  const [open, today] = await Promise.all([
    db.supportTicket.count({ where: { shopId, status: { in: ["open", "answered"] } } }),
    db.supportTicket.count({
      where: { shopId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
    }),
  ]);
  if (open >= MAX_OPEN) return { ok: false, error: "too_many_open" };
  if (today >= MAX_PER_DAY) return { ok: false, error: "too_many_today" };

  // টিকিট আর প্রথম বার্তা একসাথে: অর্ধেক তৈরি টিকিট কখনো থাকে না
  const id = randomUUID();
  const messageId = randomUUID();
  await db.$transaction([
    db.supportTicket.create({
      data: {
        id,
        shopId,
        email,
        subject,
        status: "open",
        lastAuthor: "merchant",
        lastMessageAt: now,
        merchantSeenAt: now,
        createdAt: now,
      },
    }),
    db.supportMessage.create({
      data: { id: messageId, ticketId: id, author: "merchant", body, createdAt: now },
    }),
  ]);
  await queueEmail(shopId, messageId);
  return { ok: true, id };
}

export async function listTickets(shopId: string) {
  const rows = await db.supportTicket.findMany({
    where: { shopId },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
  });
  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    status: row.status as TicketStatus,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    /** আমাদের উত্তর এসেছে, মার্চেন্ট এখনো খোলেননি */
    unread:
      row.lastAuthor === "support" &&
      (!row.merchantSeenAt || row.merchantSeenAt < row.lastMessageAt),
  }));
}

/** Contact support ফর্মে আগে থেকে বসানো ঠিকানা: স্টোরের মালিকের ইমেইল (Shopify এখানেই মালিককে লেখে) */
export async function shopOwnerEmail(admin: GraphqlClient): Promise<string> {
  try {
    const res = await admin.graphql(`#graphql
      query SupportShopEmail { shop { email } }`);
    const json = (await res.json()) as { data?: { shop?: { email?: string | null } } };
    return cleanEmail(json.data?.shop?.email) ?? "";
  } catch {
    return "";
  }
}

/** মার্চেন্টের দেখা টিকিট আর বার্তা; খোলার সময়টা মনে রাখে (উত্তর "দেখা হয়েছে") */
export async function openTicket(shopId: string, ticketId: string, now = new Date()) {
  const ticket = await db.supportTicket.findFirst({ where: { id: ticketId, shopId } });
  if (!ticket) return null;
  const messages = await threadMessages(ticket.id);
  await db.supportTicket.update({ where: { id: ticket.id }, data: { merchantSeenAt: now } });
  return { ticket, messages };
}

export async function merchantReply(
  shopId: string,
  ticketId: string,
  text: unknown,
  now = new Date(),
): Promise<Result> {
  const ticket = await db.supportTicket.findFirst({ where: { id: ticketId, shopId } });
  if (!ticket) return { ok: false, error: "not_found" };
  const body = cleanBody(text);
  if (!body) return { ok: false, error: "invalid_body" };
  if (!allowRequest(`support-reply:${shopId}`, 20, 10 * 60_000, now.getTime())) {
    return { ok: false, error: "busy" };
  }
  const message = await addMessage(ticket.id, "merchant", body, now, {
    status: "open",
    merchantSeenAt: now,
  });
  if (!message) return { ok: false, error: "full" };
  await queueEmail(shopId, message.id);
  return { ok: true };
}

/** মার্চেন্ট "সমাধান হয়েছে" বললে; পরে কিছু লিখলে টিকিট আবার খোলে */
export async function closeTicket(shopId: string, ticketId: string) {
  const { count } = await db.supportTicket.updateMany({
    where: { id: ticketId, shopId },
    data: { status: "closed" },
  });
  return count > 0;
}

/* ------------------------------------------------------------------ */
/* সাপোর্ট ডেস্ক (অ্যাপের মালিকের জন্য)                                  */
/* ------------------------------------------------------------------ */

/** SUPPORT_DESK_SHOPS: কমা বা ফাঁকা দিয়ে আলাদা করা myshopify.com ঠিকানা */
export function deskShops(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.SUPPORT_DESK_SHOPS ?? "")
    .split(/[\s,]+/)
    .map((shop) => shop.trim().toLowerCase())
    .filter((shop) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop));
}

export const isDeskShop = (shopDomain: string, env: NodeJS.ProcessEnv = process.env) =>
  deskShops(env).includes(shopDomain.toLowerCase());

export type DeskView = "open" | "answered" | "closed";

export async function deskTickets(view: DeskView, take = 100) {
  const rows = await db.supportTicket.findMany({
    where: { status: view },
    // উত্তরের অপেক্ষায় থাকা টিকিট: যেটা সবচেয়ে বেশিক্ষণ অপেক্ষা করছে সেটা আগে
    orderBy: { lastMessageAt: view === "open" ? "asc" : "desc" },
    take,
    include: { shop: true },
  });
  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    shop: row.shop.domain,
    plan: row.shop.plan,
    lastMessageAt: row.lastMessageAt,
  }));
}

export async function deskTicket(ticketId: string) {
  const ticket = await db.supportTicket.findFirst({
    where: { id: ticketId },
    include: { shop: true },
  });
  if (!ticket) return null;
  return { ticket, messages: await threadMessages(ticket.id) };
}

export async function supportReply(
  ticketId: string,
  text: unknown,
  now = new Date(),
): Promise<Result> {
  const ticket = await db.supportTicket.findFirst({ where: { id: ticketId } });
  if (!ticket) return { ok: false, error: "not_found" };
  const body = cleanBody(text);
  if (!body) return { ok: false, error: "invalid_body" };
  const message = await addMessage(ticket.id, "support", body, now, {
    status: "answered",
    firstResponseAt: ticket.firstResponseAt ?? now,
  });
  if (!message) return { ok: false, error: "full" };
  await queueEmail(ticket.shopId, message.id);
  return { ok: true };
}

/** ডেস্ক থেকে বন্ধ বা আবার খোলা; আবার খুললে শেষ বার্তা যার, অপেক্ষা তার উল্টো দিকের */
export async function setDeskStatus(ticketId: string, close: boolean) {
  const ticket = await db.supportTicket.findFirst({ where: { id: ticketId } });
  if (!ticket) return false;
  const status: TicketStatus = close
    ? "closed"
    : ticket.lastAuthor === "support"
      ? "answered"
      : "open";
  await db.supportTicket.update({ where: { id: ticket.id }, data: { status } });
  return true;
}

/** উত্তরের অপেক্ষায় কতগুলো, সবচেয়ে পুরনোটা কবে থেকে, আর শেষ ৩০ দিনে প্রথম উত্তরের মাঝামাঝি সময় */
export async function deskStats(now = new Date()) {
  const [waiting, oldest, lastWeek, reply] = await Promise.all([
    db.supportTicket.count({ where: { status: "open" } }),
    db.supportTicket.findFirst({ where: { status: "open" }, orderBy: { lastMessageAt: "asc" } }),
    db.supportTicket.count({ where: { createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
    firstReplyStats(now),
  ]);
  return { waiting, oldestWaitingSince: oldest?.lastMessageAt ?? null, lastWeek, ...reply };
}

/* ------------------------------------------------------------------ */
/* উত্তরের সময়                                                        */
/* ------------------------------------------------------------------ */

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** শেষ ৩০ দিনে খোলা টিকিটে প্রথম উত্তর আসতে কত মিনিট লেগেছে (মাঝামাঝি মান) */
export async function firstReplyStats(now = new Date()) {
  const rows = await db.supportTicket.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - STATS_DAYS * DAY_MS) },
      firstResponseAt: { not: null },
    },
    take: 5000,
  });
  const minutes = rows.map(
    (row) => (row.firstResponseAt!.getTime() - row.createdAt.getTime()) / 60_000,
  );
  return { medianReplyMinutes: median(minutes), answered: minutes.length };
}

/** মার্চেন্টকে দেখানোর উত্তরের সময়: মাপা গেলে মাপা মান, না হলে SUPPORT_REPLY_HOURS (২৪ ঘণ্টা) */
export async function typicalReplyMinutes(
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const target = Number(env.SUPPORT_REPLY_HOURS);
  const targetMinutes =
    (Number.isFinite(target) && target > 0 ? target : DEFAULT_TARGET_HOURS) * 60;
  const { medianReplyMinutes, answered } = await firstReplyStats(now);
  // মাপা মান লক্ষ্যের চেয়ে খারাপ হলেও সেটাই দেখায়: মার্চেন্টকে সত্যি সময়টা বলা হয়
  return answered >= MIN_SAMPLES && medianReplyMinutes !== null
    ? medianReplyMinutes
    : targetMinutes;
}

/* ------------------------------------------------------------------ */
/* ভেতরের কাজ                                                          */
/* ------------------------------------------------------------------ */

function threadMessages(ticketId: string) {
  return db.supportMessage.findMany({
    where: { ticketId },
    orderBy: { createdAt: "asc" },
    take: MAX_MESSAGES,
  });
}

async function addMessage(
  ticketId: string,
  author: "merchant" | "support",
  body: string,
  now: Date,
  ticketData: Record<string, unknown>,
) {
  if ((await db.supportMessage.count({ where: { ticketId } })) >= MAX_MESSAGES) return null;
  const id = randomUUID();
  const [message] = await db.$transaction([
    db.supportMessage.create({ data: { id, ticketId, author, body, createdAt: now } }),
    db.supportTicket.update({
      where: { id: ticketId },
      data: { ...ticketData, lastAuthor: author, lastMessageAt: now },
    }),
  ]);
  return message;
}

/* ------------------------------------------------------------------ */
/* ইমেইল                                                              */
/* ------------------------------------------------------------------ */

/** সাপোর্টের ইনবক্স: SUPPORT_INBOX, না থাকলে ব্র্যান্ডের সাপোর্ট ইমেইল (example.com-এর নমুনা ঠিকানা বাদ) */
export function supportInbox(env: NodeJS.ProcessEnv = process.env): string | null {
  const email = cleanEmail(env.SUPPORT_INBOX?.trim() || brand.supportEmail);
  return email && !/@example\.(com|org|net)$/.test(email) ? email : null;
}

const adminStore = (shopDomain: string) => shopDomain.replace(/\.myshopify\.com$/, "");

/** মার্চেন্টের অ্যাডমিনে টিকিটের পাতা (ইমেইলের বাটনের জন্য) */
export function helpAdminUrl(shopDomain: string, ticketId: string, env = process.env): string {
  const app = env.SHOPIFY_API_KEY;
  return app
    ? `https://admin.shopify.com/store/${adminStore(shopDomain)}/apps/${app}/app/help/${ticketId}`
    : `https://admin.shopify.com/store/${adminStore(shopDomain)}/apps`;
}

/** ডেস্কের স্টোরে ডেস্কের একটা পাতা (টিকিটের id, বা "errors"); ডেস্ক ঠিক করা না থাকলে null */
export function deskUrl(page: string, env = process.env): string | null {
  const desk = deskShops(env)[0];
  const app = env.SHOPIFY_API_KEY;
  return desk && app
    ? `https://admin.shopify.com/store/${adminStore(desk)}/apps/${app}/app/desk/${page}`
    : null;
}

async function queueEmail(shopId: string, messageId: string) {
  // ইমেইল পাঠানোর ব্যবস্থা না থাকলে কাজ জমিয়ে লাভ নেই; ডেস্ক আর Help পাতায় সব দেখা যায়
  if (emailProvider() === "none") return;
  await enqueueJob(shopId, `support-email:${messageId}`, { messageId }, { unique: true });
}

/**
 * একটা বার্তার ইমেইল: মার্চেন্টের লেখা যায় সাপোর্টের ইনবক্সে, আমাদের উত্তর যায় মার্চেন্টের কাছে।
 * সাময়িক ব্যর্থতায় error ছোড়ে, তাই কাজটা পরে আবার চলে।
 */
export async function sendSupportEmail(
  messageId: string,
  env: NodeJS.ProcessEnv = process.env,
  send = sendEmail,
): Promise<"sent" | "skipped"> {
  const message = await db.supportMessage.findFirst({ where: { id: messageId } });
  if (!message) return "skipped";
  const ticket = await db.supportTicket.findFirst({
    where: { id: message.ticketId },
    include: { shop: true },
  });
  if (!ticket) return "skipped";
  const en = createT(resolveLocale("en"));
  const fromName = en("support.email.from", { brand: brand.name });
  const vars = {
    shop: ticket.shop.domain,
    subject: ticket.subject,
    plan: en(ticket.shop.plan ? `plans.${ticket.shop.plan}` : "plans.none"),
    email: ticket.email,
  };

  let to: string | null;
  let replyTo: string | undefined;
  let content: { subject: string; body: string; buttonText: string; buttonUrl: string };
  if (message.author === "merchant") {
    to = supportInbox(env);
    const earlier = await db.supportMessage.count({
      where: { ticketId: ticket.id, createdAt: { lt: message.createdAt } },
    });
    const desk = deskUrl(ticket.id, env);
    content = {
      subject: en(earlier === 0 ? "support.email.newSubject" : "support.email.moreSubject", vars),
      body: [
        en(earlier === 0 ? "support.email.newIntro" : "support.email.moreIntro", vars),
        message.body,
        desk ? "" : en("support.email.noDesk"),
      ]
        .filter(Boolean)
        .join("\n\n"),
      buttonText: desk ? en("support.email.openDesk") : "",
      buttonUrl: desk ?? "",
    };
  } else {
    to = cleanEmail(ticket.email);
    replyTo = supportInbox(env) ?? undefined;
    content = {
      subject: en("support.email.answerSubject", vars),
      body: [
        en("support.email.answerIntro", vars),
        message.body,
        en("support.email.answerOutro"),
      ].join("\n\n"),
      buttonText: en("support.email.answerButton"),
      buttonUrl: helpAdminUrl(ticket.shop.domain, ticket.id, env),
    };
  }
  if (!to) return "skipped";

  const rendered = renderEmail(
    { ...content, preheader: "", heading: "", imageUrl: "" },
    { shopName: fromName, accent: brand.colors.primary, postalAddress: brand.legal.address },
  );
  const result = await send({ fromName, replyTo, to, ...rendered }, env);
  if (result.ok) return "sent";
  if (result.permanent) {
    console.warn(`[support] email for ${messageId} not sent: ${result.error}`);
    return "skipped";
  }
  throw new Error(result.error ?? "email failed");
}

registerJob("support-email", async (job) => {
  await sendSupportEmail(String(job.payload.messageId ?? ""));
});

/** উত্তর পাওয়ার ১৪ দিন পরেও চুপ থাকা টিকিট বন্ধ, আর এক বছরের পুরনো টিকিট মোছা */
export async function pruneSupport(now = new Date()) {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const { count: closed } = await db.supportTicket.updateMany({
    where: { status: "answered", lastMessageAt: { lt: daysAgo(CLOSE_AFTER_DAYS) } },
    data: { status: "closed" },
  });
  const { count: deleted } = await db.supportTicket.deleteMany({
    where: { lastMessageAt: { lt: daysAgo(KEEP_DAYS) } },
  });
  return { closed, deleted };
}
