import { createHash } from "node:crypto";
import { createT, resolveLocale } from "@app/i18n";
import { liveChat } from "@app/tools";
import type { z } from "@app/tool-sdk";
import db from "../db.server";
import { readEmailSettings } from "./email-template";
import { enqueueEmail } from "./messages.server";
import { enqueueJob, registerJob } from "./queue.server";
import { cleanEmail, enabledSettings, type ShopRef } from "./tool-state.server";

/**
 * Live Chat: ক্রেতা স্টোরে লেখেন, মার্চেন্ট অ্যাপের Chat পাতা থেকে উত্তর দেন।
 * - ক্রেতার ব্রাউজার একটা গোপন চাবি বানিয়ে রাখে; সার্ভারে থাকে শুধু তার hash। চাবি ছাড়া কেউ কথোপকথন পড়তে
 *   পারে না, আর ডাটাবেস দেখেও বলা যায় না কোন ব্রাউজারের কথোপকথন কোনটা।
 * - মার্চেন্ট Chat পাতা খোলা রাখলে "অনলাইন"। না থাকলে নতুন বার্তার খবর তাঁর reply-to ঠিকানায় যায়, আর ক্রেতা
 *   ইমেইল দিয়ে থাকলে মার্চেন্টের উত্তর সেখানে যায়, যদি ক্রেতা ততক্ষণে চ্যাট খুলে উত্তরটা না দেখে থাকেন।
 * - কোনো কথোপকথনে ১৮০ দিন নতুন বার্তা না এলে সেটা মুছে যায় (jobs.server.ts-এর pruneMarketingData)।
 */
export type ChatSettings = z.output<typeof liveChat.settings>;

export const MESSAGE_MAX = 1000;
/** মার্চেন্ট এর মধ্যে Chat পাতা খোলা রাখলে অনলাইন ধরা হয় */
export const ONLINE_MS = 90_000;
const PRESENCE_WRITE_MS = 30_000;
const ALERT_DELAY_MS = 60_000;
const REPLY_EMAIL_DELAY_MS = 2 * 60_000;
/** একই কথোপকথনের জন্য মার্চেন্টকে এর চেয়ে ঘনঘন ইমেইল যায় না */
const ALERT_GAP_MS = 10 * 60_000;
/** কেউ নতুন নতুন কথোপকথন খুলে মার্চেন্টের ইনবক্স ভরাতে না পারে */
const ALERTS_PER_DAY = 50;
const MAX_MESSAGES = 300;
const THREAD_PAGE = 100;
const PREVIEW_CHARS = 140;
export const RETENTION_DAYS = 180;
const KEY_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

export interface ChatShop extends ShopRef {
  domain: string;
  chatSeenAt?: Date | null;
}

export interface WireMessage {
  id: string;
  from: "visitor" | "store";
  body: string;
  at: string;
}

/** ক্রেতার চাবি → সার্ভারে রাখার hash; ভুল আকারের চাবি হলে null */
export function hashKey(raw: unknown): string | null {
  return typeof raw === "string" && KEY_PATTERN.test(raw)
    ? createHash("sha256").update(raw).digest("hex")
    : null;
}

/** বার্তার লেখা: নিয়ন্ত্রণ-অক্ষর বাদ, লাইন ঠিক করা, ফাঁকা বা খুব লম্বা হলে null */
export function cleanMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = [...raw.replace(/\r\n?/g, "\n")]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 10 || code === 9 || (code >= 32 && code !== 127);
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text && text.length <= MESSAGE_MAX ? text : null;
}

/** পাতার ঠিকানা থেকে শুধু পথ (ক্যোয়েরি, অন্য সাইট বা ভাঙা কিছু নয়) */
export function cleanPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.split(/[?#]/)[0]?.trim() ?? "";
  return /^\/(?!\/)\S{0,299}$/.test(path) ? path : null;
}

const cleanLocale = (raw: unknown) =>
  typeof raw === "string" && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(raw) ? raw : "en";

export const isOnline = (seenAt: Date | null | undefined, now = new Date()) =>
  Boolean(seenAt && now.getTime() - seenAt.getTime() < ONLINE_MS);

/** Chat পাতা খোলা থাকলে প্রতিবার ডাকা হয়; ডাটাবেসে লেখে আধা মিনিটে একবার */
export async function markPresence(shopId: string, now = new Date()) {
  await db.shop.updateMany({
    where: {
      id: shopId,
      OR: [
        { chatSeenAt: null },
        { chatSeenAt: { lt: new Date(now.getTime() - PRESENCE_WRITE_MS) } },
      ],
    },
    data: { chatSeenAt: now },
  });
}

const toWire = (message: {
  id: string;
  author: string;
  body: string;
  createdAt: Date;
}): WireMessage => ({
  id: message.id,
  from: message.author === "merchant" ? "store" : "visitor",
  body: message.body,
  at: message.createdAt.toISOString(),
});

const preview = (body: string) => body.replace(/\s+/g, " ").slice(0, PREVIEW_CHARS);

function findConversation(shopId: string, visitorKey: string) {
  return db.chatConversation.findUnique({ where: { shopId_visitorKey: { shopId, visitorKey } } });
}

export async function hasConversation(shopId: string, visitorKey: string) {
  return (await findConversation(shopId, visitorKey)) !== null;
}

/**
 * ক্রেতার চ্যাট: মার্চেন্ট অনলাইন কিনা আর বার্তাগুলো। `since` দিলে শুধু তার পরের (আর সেই মুহূর্তের) বার্তা,
 * না দিলে শেষ ১০০টা। `open` মানে ক্রেতা চ্যাট খোলা রেখে দেখছেন: তখন উত্তরের ইমেইল আর যায় না।
 */
export async function visitorThread(
  shop: ChatShop,
  visitorKey: string | null,
  options: { since?: Date | null; open?: boolean } = {},
  now = new Date(),
) {
  const online = isOnline(shop.chatSeenAt, now);
  const conversation = visitorKey ? await findConversation(shop.id, visitorKey) : null;
  if (!conversation) return { online, messages: [] as WireMessage[], hasEmail: false };
  const seen = conversation.visitorSeenAt;
  if (
    options.open &&
    (!seen ||
      seen < conversation.lastMessageAt ||
      now.getTime() - seen.getTime() > PRESENCE_WRITE_MS)
  ) {
    await db.chatConversation.update({
      where: { id: conversation.id },
      data: { visitorSeenAt: now },
    });
  }
  const since = options.since;
  const rows = await db.chatMessage.findMany({
    where: { conversationId: conversation.id, ...(since ? { createdAt: { gte: since } } : {}) },
    orderBy: { createdAt: since ? "asc" : "desc" },
    take: THREAD_PAGE,
  });
  const messages = (since ? rows : rows.reverse()).map(toWire);
  return { online, messages, hasEmail: Boolean(conversation.email) };
}

export type SendError = "invalid" | "invalid_email" | "email_required" | "full";

/** ক্রেতার নতুন বার্তা; প্রথম বার্তায় কথোপকথন তৈরি হয় */
export async function visitorSend(
  shop: ChatShop,
  settings: Pick<ChatSettings, "askEmail">,
  input: {
    visitorKey: string;
    text: unknown;
    email?: unknown;
    page?: unknown;
    locale?: unknown;
    customerId?: string | null;
  },
  now = new Date(),
): Promise<{ ok: true; message: WireMessage; online: boolean } | { ok: false; error: SendError }> {
  const body = cleanMessage(input.text);
  if (!body) return { ok: false, error: "invalid" };
  const asks = settings.askEmail !== "never";
  const email = asks ? cleanEmail(input.email) : null;
  if (asks && typeof input.email === "string" && input.email.trim() && !email) {
    return { ok: false, error: "invalid_email" };
  }
  const online = isOnline(shop.chatSeenAt, now);
  const existing = await findConversation(shop.id, input.visitorKey);
  const needsEmail = settings.askEmail === "always" || (settings.askEmail === "offline" && !online);
  if (needsEmail && !email && !existing?.email) return { ok: false, error: "email_required" };
  if (
    existing &&
    (await db.chatMessage.count({ where: { conversationId: existing.id } })) >= MAX_MESSAGES
  ) {
    return { ok: false, error: "full" };
  }

  const customerId =
    input.customerId && /^\d{1,20}$/.test(input.customerId) ? input.customerId : null;
  const data = {
    lastMessageAt: now,
    preview: preview(body),
    lastAuthor: "visitor",
    status: "open",
    pagePath: cleanPath(input.page),
    locale: cleanLocale(input.locale),
    ...(email ? { email } : {}),
    ...(customerId ? { customerId } : {}),
  };
  // একই ব্রাউজার থেকে একসাথে দুটো প্রথম বার্তা এলেও কথোপকথন একটাই হয়
  const conversation = await db.chatConversation.upsert({
    where: { shopId_visitorKey: { shopId: shop.id, visitorKey: input.visitorKey } },
    create: { shopId: shop.id, visitorKey: input.visitorKey, unread: 1, ...data },
    update: { ...data, unread: { increment: 1 } },
  });
  const message = await db.chatMessage.create({
    data: { conversationId: conversation.id, author: "visitor", body, createdAt: now },
  });
  if (!online) {
    await enqueueJob(
      shop.id,
      `chat-alert:${conversation.id}`,
      { conversationId: conversation.id },
      { runAt: new Date(now.getTime() + ALERT_DELAY_MS), unique: true },
    );
  }
  return { ok: true, message: toWire(message), online };
}

/* ------------------------------------------------------------------ */
/* মার্চেন্টের Chat পাতা                                                */
/* ------------------------------------------------------------------ */

export type ChatView = "open" | "closed";

export function listConversations(shopId: string, view: ChatView, take = 50) {
  return db.chatConversation.findMany({
    where: { shopId, status: view },
    orderBy: { lastMessageAt: "desc" },
    take,
    select: {
      id: true,
      email: true,
      customerId: true,
      status: true,
      unread: true,
      preview: true,
      lastAuthor: true,
      lastMessageAt: true,
    },
  });
}

export async function unreadTotal(shopId: string) {
  const rows = await db.chatConversation.findMany({
    where: { shopId, status: "open", unread: { gt: 0 } },
    select: { unread: true },
  });
  return rows.reduce((sum, row) => sum + row.unread, 0);
}

/** একটা কথোপকথন খোলে (শেষ ২০০টা বার্তা) আর পড়া হয়েছে বলে ধরে */
export async function openConversation(shopId: string, id: string) {
  const conversation = await db.chatConversation.findFirst({ where: { id, shopId } });
  if (!conversation) return null;
  if (conversation.unread > 0) {
    await db.chatConversation.update({ where: { id }, data: { unread: 0 } });
  }
  const rows = await db.chatMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return {
    conversation: {
      id: conversation.id,
      email: conversation.email,
      customerId: conversation.customerId,
      pagePath: conversation.pagePath,
      status: conversation.status,
      createdAt: conversation.createdAt,
      visitorSeenAt: conversation.visitorSeenAt,
    },
    messages: rows.reverse().map(toWire),
  };
}

export async function merchantReply(shopId: string, id: string, raw: unknown, now = new Date()) {
  const body = cleanMessage(raw);
  if (!body) return { ok: false as const, error: "invalid" as const };
  const conversation = await db.chatConversation.findFirst({ where: { id, shopId } });
  if (!conversation) return { ok: false as const, error: "not_found" as const };
  await db.chatMessage.create({
    data: { conversationId: id, author: "merchant", body, createdAt: now },
  });
  await db.chatConversation.update({
    where: { id },
    data: {
      lastMessageAt: now,
      preview: preview(body),
      lastAuthor: "merchant",
      unread: 0,
      status: "open",
    },
  });
  if (conversation.email) {
    await enqueueJob(
      shopId,
      `chat-reply:${id}`,
      { conversationId: id },
      { runAt: new Date(now.getTime() + REPLY_EMAIL_DELAY_MS), unique: true },
    );
  }
  return { ok: true as const };
}

export async function setConversationStatus(shopId: string, id: string, status: ChatView) {
  const { count } = await db.chatConversation.updateMany({
    where: { id, shopId },
    data: { status, ...(status === "closed" ? { unread: 0 } : {}) },
  });
  return count > 0;
}

/* ------------------------------------------------------------------ */
/* ইমেইল                                                               */
/* ------------------------------------------------------------------ */

/** ইমেইলের বোতাম থেকে সোজা অ্যাপের Chat পাতার এই কথোপকথনে */
export function chatAdminUrl(shopDomain: string, conversationId: string): string {
  const store = shopDomain.replace(/\.myshopify\.com$/, "");
  const app = process.env.SHOPIFY_API_KEY;
  return app
    ? `https://admin.shopify.com/store/${store}/apps/${app}/app/chat?c=${conversationId}`
    : `https://admin.shopify.com/store/${store}/apps`;
}

const later = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));

async function chatContext(conversationId: string) {
  const conversation = await db.chatConversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return null;
  const shop = await db.shop.findUnique({ where: { id: conversation.shopId } });
  if (!shop || shop.uninstalledAt || !(await enabledSettings(shop, liveChat))) return null;
  return { conversation, shop };
}

/**
 * ক্রেতাকে মার্চেন্টের উত্তর: শুধু যে উত্তরগুলো ক্রেতা চ্যাটে এখনো দেখেননি আর আগে ইমেইলে যায়নি।
 */
export async function sendReplyEmail(conversationId: string) {
  const ctx = await chatContext(conversationId);
  const to = ctx?.conversation.email;
  if (!ctx || !to) return false;
  const { conversation, shop } = ctx;
  const after = later(conversation.visitorSeenAt, conversation.emailedAt);
  const replies = await db.chatMessage.findMany({
    where: { conversationId, author: "merchant", ...(after ? { createdAt: { gt: after } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const last = replies[replies.length - 1];
  if (!last) return false;
  const t = createT(resolveLocale(conversation.locale));
  const replyTo = readEmailSettings(shop.emailSettings).replyTo;
  await enqueueEmail(shop.id, {
    kind: "chat",
    to,
    refId: `reply:${conversation.id}`,
    dedupeKey: `chat-reply:${last.id}`,
    payload: {
      marketing: false,
      content: {
        subject: t("chat.email.replySubject"),
        preheader: "",
        heading: "",
        body: [
          t("chat.email.replyIntro"),
          "{messages}",
          t(replyTo ? "chat.email.replyOutro" : "chat.email.replyOutroNoEmail"),
        ].join("\n\n"),
        buttonText: t("chat.email.replyButton"),
        buttonUrl: `https://${shop.domain}/?app_chat=open`,
        imageUrl: "",
      },
      // ক্রেতা বা মার্চেন্টের লেখা vars দিয়ে বসে, তাই লেখার ভেতরের {..} আর বদলায় না
      vars: { messages: replies.map((reply) => reply.body).join("\n\n") },
    },
  });
  await db.chatConversation.update({
    where: { id: conversation.id },
    data: { emailedAt: last.createdAt },
  });
  return true;
}

/**
 * মার্চেন্টকে নতুন বার্তার খবর (reply-to ঠিকানায়), যদি তিনি এর মধ্যে Chat পাতা খুলে না থাকেন।
 * একই কথোপকথনে ১০ মিনিটে একবারের বেশি নয় (তখন কাজটা পরে আবার চলে), আর দিনে ৫০টার বেশি নয়।
 */
export async function sendAlert(conversationId: string, now = new Date()) {
  const ctx = await chatContext(conversationId);
  if (!ctx || ctx.conversation.unread === 0 || isOnline(ctx.shop.chatSeenAt, now)) {
    return { sent: false };
  }
  const { conversation, shop } = ctx;
  const to = readEmailSettings(shop.emailSettings).replyTo;
  if (!to) return { sent: false };
  if (conversation.alertedAt) {
    const wait = conversation.alertedAt.getTime() + ALERT_GAP_MS - now.getTime();
    if (wait > 0) return { sent: false, retryInMs: wait };
  }
  const today = await db.message.count({
    where: {
      shopId: shop.id,
      kind: "chat",
      refId: { startsWith: "alert:" },
      createdAt: { gte: new Date(now.getTime() - 86_400_000) },
    },
  });
  if (today >= ALERTS_PER_DAY) return { sent: false };
  const fresh = await db.chatMessage.findMany({
    where: {
      conversationId,
      author: "visitor",
      ...(conversation.alertedAt ? { createdAt: { gt: conversation.alertedAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const last = fresh[fresh.length - 1];
  if (!last) return { sent: false };
  // মার্চেন্টের ইমেইল ইংরেজিতে (অ্যাডমিনের ভাষা এখানে জানা নেই), withdrawal-এর খবরের মতোই
  const en = createT(resolveLocale("en"));
  await enqueueEmail(shop.id, {
    kind: "chat",
    to,
    refId: `alert:${conversation.id}`,
    dedupeKey: `chat-alert:${last.id}`,
    payload: {
      marketing: false,
      content: {
        subject: en("chat.email.alertSubject"),
        preheader: "",
        heading: "",
        body: [
          en("chat.email.alertIntro"),
          "{messages}",
          en(conversation.email ? "chat.email.alertHasEmail" : "chat.email.alertNoEmail"),
        ].join("\n\n"),
        buttonText: en("chat.email.alertButton"),
        buttonUrl: chatAdminUrl(shop.domain, conversation.id),
        imageUrl: "",
      },
      vars: {
        who: conversation.email ?? en("chat.email.someone"),
        page: conversation.pagePath ?? "/",
        messages: fresh.map((message) => message.body).join("\n\n"),
      },
    },
  });
  await db.chatConversation.update({
    where: { id: conversation.id },
    data: { alertedAt: last.createdAt },
  });
  return { sent: true };
}

registerJob("chat-alert", async (job) => {
  const result = await sendAlert(String(job.payload.conversationId ?? ""));
  if (result.retryInMs) return { again: true, delayMs: result.retryInMs };
});

registerJob("chat-reply", async (job) => {
  await sendReplyEmail(String(job.payload.conversationId ?? ""));
});

/** অনেক দিন চুপ থাকা কথোপকথন মুছে ফেলে (ক্রেতার লেখা অকারণে জমিয়ে রাখা হয় না) */
export async function pruneChats(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const { count } = await db.chatConversation.deleteMany({
    where: { lastMessageAt: { lt: cutoff } },
  });
  return count;
}
