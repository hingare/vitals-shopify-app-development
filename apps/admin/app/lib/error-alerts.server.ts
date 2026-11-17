import { brand } from "@app/brand";
import { createT, resolveLocale } from "@app/i18n";
import db from "../db.server";
import { renderEmail } from "./email-render";
import { emailProvider, sendEmail } from "./email-transport.server";
import { sourceKey } from "./errors";
import { deskUrl, supportInbox } from "./support.server";

/**
 * নতুন ধরনের ত্রুটির খবর সাপোর্টের ইনবক্সে (SUPPORT_INBOX): jobs.server ১০ মিনিটে একবার ডাকে, আর সেই সময়ের
 * নতুন ত্রুটিগুলো একটা ইমেইলে যায়।
 * - প্রতিটা ধরন একবারই জানানো হয়; ঠিক করা বলে চিহ্নিত ত্রুটি আবার ঘটলে আবার জানানো হয় (errors.server)।
 * - একাধিক সার্ভার চললেও একই ত্রুটি দুবার যায় না: প্রতিটা সারি আগে নিজের নামে ধরা হয়, তারপর পাঠানো।
 * - কিছু একটা ভেঙে হাজার রকম ত্রুটি এলেও ২৪ ঘণ্টায় ১০০টার বেশি জানানো হয় না; সব ডেস্কের Errors পাতায় থাকে।
 * - পাঠানো সাময়িকভাবে ব্যর্থ হলে পরের বার আবার চেষ্টা হয়।
 */
const PER_EMAIL = 20;
const DAILY_LIMIT = 100;
const DAY_MS = 86_400_000;

export async function sendErrorAlerts(
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
  send = sendEmail,
): Promise<{ sent: number }> {
  const to = supportInbox(env);
  if (!to || emailProvider(env) === "none") return { sent: 0 };

  const alreadyToday = await db.appError.count({
    where: { notifiedAt: { gte: new Date(now.getTime() - DAY_MS) } },
  });
  const room = Math.min(PER_EMAIL, DAILY_LIMIT - alreadyToday);
  if (room <= 0) return { sent: 0 };
  const fresh = await db.appError.findMany({
    where: { notifiedAt: null, resolvedAt: null },
    orderBy: { firstSeenAt: "asc" },
    take: room,
  });
  // অন্য সার্ভার আগে ধরে ফেললে সেটা তার; এখানে বাদ
  const mine: typeof fresh = [];
  for (const row of fresh) {
    const { count } = await db.appError.updateMany({
      where: { id: row.id, notifiedAt: null },
      data: { notifiedAt: now },
    });
    if (count > 0) mine.push(row);
  }
  if (mine.length === 0) return { sent: 0 };
  const waiting = await db.appError.count({ where: { notifiedAt: null, resolvedAt: null } });

  const en = createT(resolveLocale("en"));
  const fromName = en("support.email.from", { brand: brand.name });
  const desk = deskUrl("errors", env);
  const lines = mine.map((row) =>
    [
      `${row.name}: ${row.message}`,
      en("deskErrors.email.line", {
        source: en(sourceKey(row.source)),
        location: row.location,
        count: row.count,
        shop: row.lastShop ?? en("deskErrors.unknownStore"),
      }),
    ].join("\n"),
  );
  const subject = en("deskErrors.email.subject", { n: mine.length, brand: brand.name });
  const rendered = renderEmail(
    {
      subject,
      preheader: "",
      heading: "",
      imageUrl: "",
      body: [
        en("deskErrors.email.intro", { brand: brand.name }),
        ...lines,
        waiting > 0 ? en("deskErrors.email.more", { n: waiting }) : "",
        desk ? "" : en("deskErrors.email.noDesk"),
      ]
        .filter(Boolean)
        .join("\n\n"),
      buttonText: desk ? en("deskErrors.email.button") : "",
      buttonUrl: desk ?? "",
    },
    { shopName: fromName, accent: brand.colors.primary, postalAddress: brand.legal.address },
  );

  const result = await send({ fromName, to, ...rendered }, env);
  if (result.ok) return { sent: mine.length };
  if (!result.permanent) {
    // সাময়িক সমস্যা: ধরা সারিগুলো ছেড়ে দেওয়া, পরের বার আবার চেষ্টা
    await db.appError.updateMany({
      where: { id: { in: mine.map((row) => row.id) }, notifiedAt: now },
      data: { notifiedAt: null },
    });
  }
  console.warn(`[error-alerts] email not sent: ${result.error ?? "unknown error"}`);
  return { sent: 0 };
}
