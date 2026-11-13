import { createT, resolveLocale } from "@app/i18n";
import { euWithdrawal } from "@app/tools";
import db from "../db.server";
import { readEmailSettings } from "./email-template";
import { enqueueEmail } from "./messages.server";
import { cleanEmail, enabledSettings, type ShopRef } from "./tool-state.server";

/**
 * EU Withdrawal Button: ক্রেতা স্টোরের ফর্ম থেকে চুক্তি প্রত্যাহারের বিবৃতি জমা দেন।
 *
 * নিয়ম (EU Directive 2023/2673) অনুযায়ী জমা পড়ার পর দেরি না করে ক্রেতাকে প্রাপ্তিস্বীকার পাঠাতে হয়,
 * যাতে থাকে তিনি কী জমা দিলেন আর কোন তারিখ ও সময়ে। তাই:
 * - অর্ডার নম্বর বা ইমেইল আমাদের কাছে মিলুক বা না মিলুক, বিবৃতি নেওয়া হয়। ঠিক-ভুল মার্চেন্ট দেখেন;
 *   ফর্ম কাউকে ফিরিয়ে দিলে তাঁর প্রত্যাহারের অধিকারে বাধা পড়ত।
 * - প্রাপ্তিস্বীকারের ইমেইলে জমা দেওয়া তথ্য আর সময় সব সময় থাকে, মার্চেন্ট লেখা বদলালেও।
 * - মার্চেন্ট Marketing পেজে reply-to ঠিকানা দিয়ে থাকলে সেখানেও একটা খবর যায়, কারণ টাকা ফেরতের
 *   সময়সীমা বিবৃতি পাওয়ার দিন থেকে গোনা শুরু হয়; অ্যাপ না খুললেও তিনি যেন জানতে পারেন।
 * - ফর্মটা খোলা, তাই অপব্যবহার (অন্যের ঠিকানায় ইমেইল পাঠানো) ঠেকাতে সীমা আছে।
 */
export const WITHDRAWAL_LIMITS = { name: 120, order: 40, details: 1000 } as const;
/** একই ঠিকানা থেকে ২৪ ঘণ্টায় এর বেশি বিবৃতি নয় */
const MAX_PER_EMAIL_PER_DAY = 5;
/** এক স্টোরে এক ঘণ্টায় এর বেশি নয় (হাজার ঠিকানায় ইমেইল ছড়ানো ঠেকাতে) */
const MAX_PER_SHOP_PER_HOUR = 100;
/** একই অর্ডারের বিবৃতি এই সময়ের মধ্যে আবার এলে নতুন করে ধরা হয় না (দুবার ক্লিক) */
const REPEAT_WINDOW_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

type ShopRow = ShopRef & { domain: string; emailSettings?: unknown };

export interface WithdrawalInput {
  name: unknown;
  email: unknown;
  order: unknown;
  details?: unknown;
  locale?: unknown;
}

export type WithdrawalResult =
  | {
      ok: true;
      id: string;
      submittedAt: Date;
      /** প্রাপ্তিস্বীকারে লেখা তারিখ ও সময়; পেজেও হুবহু এটাই দেখানো হয় */
      submitted: string;
      repeated: boolean;
    }
  | { ok: false; error: "disabled" | "invalid" | "too_many" };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** এক লাইনের লেখা: লাইন ভাঙা আর বাড়তি ফাঁক বাদ */
function oneLine(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  return text.length > 0 && text.length <= max ? text : null;
}

/** কয়েক লাইনের লেখা (ফাঁকা থাকতে পারে): টানা ফাঁকা লাইন একটা করে */
function manyLines(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text.length <= max ? text : null;
}

/**
 * প্রাপ্তিস্বীকারে লেখা তারিখ ও সময়। সময় অঞ্চল সব সময় UTC আর তা লেখাও থাকে, যাতে ক্রেতা আর
 * মার্চেন্ট আলাদা দেশে থাকলেও সময় নিয়ে দ্বিমত না হয়।
 */
export function submittedText(date: Date, locale: string): string {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  };
  let text: string;
  try {
    text = new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    text = new Intl.DateTimeFormat("en", options).format(date);
  }
  // কিছু ভাষায় Intl সরু বা না-ভাঙা ফাঁক বসায়; সাধারণ ফাঁক সব ইমেইল ক্লায়েন্টে ঠিক দেখায়
  return `${text.replace(/[\u202F\u00A0]/g, " ")} UTC`;
}

const cleanLocale = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/.test(value) ? value : "en";

/** বিবৃতি জমা নেয় আর প্রাপ্তিস্বীকারের ইমেইল লাইনে দেয় */
export async function submitWithdrawal(
  shop: ShopRow,
  input: WithdrawalInput,
  now = new Date(),
): Promise<WithdrawalResult> {
  const settings = await enabledSettings(shop, euWithdrawal);
  if (!settings) return { ok: false, error: "disabled" };

  const name = oneLine(input.name, WITHDRAWAL_LIMITS.name);
  const orderNumber = oneLine(input.order, WITHDRAWAL_LIMITS.order);
  const details = manyLines(input.details, WITHDRAWAL_LIMITS.details);
  const email = cleanEmail(input.email);
  if (!name || !orderNumber || details === null || !email) return { ok: false, error: "invalid" };
  const locale = cleanLocale(input.locale);

  const sameEmail = await db.withdrawalRequest.findMany({
    where: { shopId: shop.id, email, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
    orderBy: { createdAt: "desc" },
    take: MAX_PER_EMAIL_PER_DAY,
  });
  const repeat = sameEmail.find(
    (row) =>
      row.orderNumber.toLowerCase() === orderNumber.toLowerCase() &&
      now.getTime() - row.createdAt.getTime() < REPEAT_WINDOW_MS,
  );
  // দুবার ক্লিক বা পেজ রিফ্রেশ: প্রথমবারের সময়টাই ক্রেতার জমা দেওয়ার সময়
  if (repeat) {
    return {
      ok: true,
      id: repeat.id,
      submittedAt: repeat.createdAt,
      submitted: submittedText(repeat.createdAt, locale),
      repeated: true,
    };
  }
  if (sameEmail.length >= MAX_PER_EMAIL_PER_DAY) return { ok: false, error: "too_many" };
  const lastHour = await db.withdrawalRequest.count({
    where: { shopId: shop.id, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
  });
  if (lastHour >= MAX_PER_SHOP_PER_HOUR) return { ok: false, error: "too_many" };

  const request = await db.withdrawalRequest.create({
    data: { shopId: shop.id, name, email, orderNumber, details, createdAt: now },
  });

  const t = createT(resolveLocale(locale));
  const submitted = submittedText(now, locale);
  // ক্রেতার লেখা সরাসরি টেমপ্লেটে বসে না, {name} ইত্যাদির মান হিসেবে যায়: তাই তাঁর লেখায়
  // "{shop}" থাকলেও তা বদলায় না, আর HTML হিসেবে চলে না (renderEmail সব escape করে)
  const summary = [
    `${t("withdrawals.ack.name")}: {name}`,
    `${t("withdrawals.ack.order")}: {order}`,
    `${t("withdrawals.ack.email")}: {email}`,
    ...(details ? [`${t("withdrawals.ack.details")}: {details}`] : []),
    `${t("withdrawals.ack.submitted")}: {date}`,
  ].join("\n");
  await enqueueEmail(shop.id, {
    kind: "withdrawal",
    to: email,
    refId: request.id,
    dedupeKey: `withdrawal:${request.id}`,
    sendAt: now,
    payload: {
      marketing: false,
      content: {
        subject: settings.ackSubject || "We received your withdrawal",
        preheader: "",
        heading: "",
        body: [settings.ackBody, summary].filter(Boolean).join("\n\n"),
        buttonText: "",
        buttonUrl: "",
        imageUrl: "",
      },
      vars: { name, order: orderNumber, email, details, date: submitted },
    },
  });

  const merchant = readEmailSettings(shop.emailSettings).replyTo;
  if (merchant) {
    // মার্চেন্টের জন্য লেখা ইংরেজিতে (অ্যাডমিনের ভাষা এখানে জানা নেই); তারিখও তাই
    const en = createT(resolveLocale("en"));
    await enqueueEmail(shop.id, {
      kind: "withdrawal",
      to: merchant,
      // refId আলাদা, যাতে তালিকায় ক্রেতার প্রাপ্তিস্বীকারের অবস্থার সাথে না মেশে
      refId: `notice:${request.id}`,
      dedupeKey: `withdrawal-notice:${request.id}`,
      sendAt: now,
      payload: {
        marketing: false,
        content: {
          subject: en("withdrawals.notice.subject"),
          preheader: "",
          heading: "",
          body: [
            en("withdrawals.notice.body"),
            [
              `${en("withdrawals.ack.name")}: {name}`,
              `${en("withdrawals.ack.order")}: {order}`,
              `${en("withdrawals.ack.email")}: {email}`,
              ...(details ? [`${en("withdrawals.ack.details")}: {details}`] : []),
              `${en("withdrawals.ack.submitted")}: {date}`,
            ].join("\n"),
            en("withdrawals.notice.next"),
          ].join("\n\n"),
          buttonText: "",
          buttonUrl: "",
          imageUrl: "",
        },
        vars: {
          name,
          order: orderNumber,
          email,
          details,
          date: submittedText(now, "en"),
        },
      },
    });
  }
  return { ok: true, id: request.id, submittedAt: now, submitted, repeated: false };
}

/** নতুন (এখনো দেখা হয়নি এমন) বিবৃতির সংখ্যা: ড্যাশবোর্ডের খবরের জন্য */
export function openWithdrawals(shopId: string) {
  return db.withdrawalRequest.count({ where: { shopId, status: "new" } });
}

export const WITHDRAWALS_PAGE = 50;

export type AckStatus = "sent" | "queued" | "failed";

export interface WithdrawalRow {
  id: string;
  name: string;
  email: string;
  orderNumber: string;
  details: string;
  status: "new" | "handled";
  createdAt: string;
  /** প্রাপ্তিস্বীকার ইমেইলের অবস্থা; ইমেইলের রেকর্ড না থাকলে null */
  ack: AckStatus | null;
}

/** অ্যাডমিন পেজের তালিকা: সবচেয়ে নতুন অনুরোধ ওপরে, সাথে প্রাপ্তিস্বীকার ইমেইলের অবস্থা */
export async function listWithdrawals(shopId: string, take = WITHDRAWALS_PAGE) {
  const [rows, total, open] = await Promise.all([
    db.withdrawalRequest.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take,
    }),
    db.withdrawalRequest.count({ where: { shopId } }),
    db.withdrawalRequest.count({ where: { shopId, status: "new" } }),
  ]);
  const messages =
    rows.length === 0
      ? []
      : await db.message.findMany({
          where: { shopId, kind: "withdrawal", refId: { in: rows.map((row) => row.id) } },
          select: { refId: true, status: true },
        });
  const ackById = new Map(messages.map((m) => [m.refId, m.status]));
  const ack = (id: string): AckStatus | null => {
    const status = ackById.get(id);
    if (!status) return null;
    if (status === "sent") return "sent";
    return status === "queued" || status === "sending" ? "queued" : "failed";
  };
  return {
    total,
    open,
    rows: rows.map((row): WithdrawalRow => ({
      id: row.id,
      name: row.name,
      email: row.email,
      orderNumber: row.orderNumber,
      details: row.details,
      status: row.status === "handled" ? "handled" : "new",
      createdAt: row.createdAt.toISOString(),
      ack: ack(row.id),
    })),
  };
}

/** মার্চেন্ট কাজ শেষ করে "handled" চিহ্ন দেন (বা ফেরান)। অন্য স্টোরের অনুরোধ ছোঁয়া যায় না। */
export async function setWithdrawalStatus(shopId: string, id: string, status: "new" | "handled") {
  const { count } = await db.withdrawalRequest.updateMany({
    where: { id, shopId },
    data: { status },
  });
  return count > 0;
}
