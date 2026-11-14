import db from "../db.server";
import { cleanEmail } from "./tool-state.server";

/**
 * ক্রেতার ব্যক্তিগত তথ্য কোন কোন টেবিলে আছে তার এক জায়গার হিসাব। GDPR-এর দুটো কাজ এখান থেকে হয়:
 * - customerData: এক ক্রেতার যা যা আমাদের কাছে আছে। মার্চেন্ট Subscribers পেজ থেকে এটা নামিয়ে ক্রেতাকে দেন
 *   (Shopify-র customers/data_request)।
 * - redactCustomer: সেই ক্রেতার সব তথ্য মোছা (Shopify-র customers/redact)।
 *
 * নতুন কোনো টেবিলে ক্রেতার ইমেইল, নাম বা customer id রাখলে এই ফাইলের দুই ফাংশনেই যোগ করতে হবে।
 * স্টোরের সব তথ্য মোছা (shop/redact) আলাদা: Shop সারি মুছলে বাকি সব টেবিল cascade-এ মুছে যায়।
 *
 * যা এখানে নেই, কারণ তাতে ক্রেতাকে চেনার কিছু নেই: PushSubscription (শুধু ব্রাউজারের দেওয়া ঠিকানা ও চাবি),
 * অতিথির wishlist (র‍্যান্ডম id), আর দিনের মোট হিসাবের টেবিলগুলো।
 * ব্যাকগ্রাউন্ড কাজের সারিতে (Job) ঠিকানা থাকে অল্প সময়ের জন্য; মোছার সময় সেগুলোও যায়, কিন্তু নামানো ফাইলে আসে না।
 */
export interface CustomerRef {
  email?: unknown;
  /** Shopify customer-এর সংখ্যা-id */
  customerId?: unknown;
}

interface Identity {
  /** ছোট হাতের অক্ষরে; এই ক্রেতার জানা সব ঠিকানা */
  emails: string[];
  customerId: string | null;
}

/**
 * ক্রেতাকে চেনার উপায়গুলো জড়ো করে: দেওয়া ইমেইল, আর customer id মিললে আমাদের তালিকায় থাকা তাঁর ঠিকানা।
 * শুধু ইমেইল দেওয়া হলে (মার্চেন্ট Subscribers পেজে খুঁজলে) আমাদের তালিকা থেকে তাঁর customer id নেওয়া হয়,
 * কারণ লগইন করা ক্রেতার wishlist ইমেইলে নয়, ওই id-তে রাখা।
 */
async function identify(shopId: string, ref: CustomerRef): Promise<Identity> {
  const email = cleanEmail(ref.email);
  // খুব বড় সংখ্যা JSON থেকে পড়লে হুবহু থাকে না: ভুল id দিয়ে অন্য ক্রেতার তথ্য ধরার চেয়ে id ছাড়া চলা ভালো
  const rawId =
    typeof ref.customerId === "string" ||
    (typeof ref.customerId === "number" && Number.isSafeInteger(ref.customerId))
      ? String(ref.customerId)
      : "";
  let customerId = /^\d{1,20}$/.test(rawId) ? rawId : null;
  const emails = new Set<string>(email ? [email] : []);
  if (!customerId && email) {
    const listed = await db.subscriber.findFirst({
      where: { shopId, email },
      select: { customerId: true },
    });
    customerId = listed?.customerId ?? null;
  }
  if (customerId) {
    // ক্রেতা Shopify-তে ইমেইল বদলে থাকলে আমাদের কাছে পুরোনো ঠিকানাও থাকতে পারে
    const known = await db.subscriber.findMany({
      where: { shopId, customerId },
      select: { email: true },
    });
    for (const row of known) emails.add(row.email);
  }
  return { emails: [...emails], customerId };
}

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

/** ইমেইলের বিষয় (payload-এর ভেতর থেকে); না থাকলে ফাঁকা */
function subjectOf(payload: unknown): string {
  const content = (payload as { content?: { subject?: unknown } } | null)?.content;
  return typeof content?.subject === "string" ? content.subject : "";
}

/** Live Chat-এর কথোপকথন: ক্রেতার দেওয়া ইমেইল বা লগইন করা ক্রেতার id দিয়ে */
function chatsOf(shopId: string, emails: string[], customerId: string | null) {
  const or = [
    ...(emails.length ? [{ email: { in: emails } }] : []),
    ...(customerId ? [{ customerId }] : []),
  ];
  return or.length
    ? db.chatConversation.findMany({ where: { shopId, OR: or } })
    : Promise.resolve([]);
}

/** এক ক্রেতার যা যা তথ্য এই স্টোরের জন্য আমাদের কাছে আছে */
export async function customerData(shopId: string, ref: CustomerRef) {
  const { emails, customerId } = await identify(shopId, ref);
  const byEmail = { shopId, email: { in: emails } };
  const none = emails.length === 0;
  const [subscribers, messages, reviews, checkouts, alerts, spins, withdrawals, wishlist] =
    await Promise.all([
      none ? [] : db.subscriber.findMany({ where: byEmail }),
      none
        ? []
        : db.message.findMany({
            where: { shopId, recipient: { in: emails } },
            orderBy: { createdAt: "desc" },
            take: 500,
          }),
      none
        ? []
        : db.review.findMany({
            where: { shopId, authorEmail: { in: emails } },
            orderBy: { createdAt: "desc" },
          }),
      none ? [] : db.abandonedCheckout.findMany({ where: byEmail }),
      none ? [] : db.stockAlert.findMany({ where: byEmail }),
      none ? [] : db.wheelSpin.findMany({ where: byEmail }),
      none ? [] : db.withdrawalRequest.findMany({ where: byEmail }),
      customerId ? db.wishlistItem.findMany({ where: { shopId, owner: `c:${customerId}` } }) : [],
    ]);
  const chats = await chatsOf(shopId, emails, customerId);
  const chatMessages = chats.length
    ? await db.chatMessage.findMany({
        where: { conversationId: { in: chats.map((row) => row.id) } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return {
    customer: { emails, customerId },
    subscriber: subscribers.map((row) => ({
      email: row.email,
      firstName: row.firstName,
      status: row.status,
      source: row.source,
      consentAt: iso(row.consentAt),
      unsubscribedAt: iso(row.unsubscribedAt),
      lastOrderAt: iso(row.lastOrderAt),
      createdAt: iso(row.createdAt),
    })),
    emails: messages.map((row) => ({
      to: row.recipient,
      kind: row.kind,
      subject: subjectOf(row.payload),
      status: row.status,
      createdAt: iso(row.createdAt),
      sentAt: iso(row.sentAt),
      openedAt: iso(row.openedAt),
      clickedAt: iso(row.clickedAt),
    })),
    reviews: reviews.map((row) => ({
      productId: row.productId,
      rating: row.rating,
      title: row.title,
      body: row.body,
      name: row.authorName,
      email: row.authorEmail,
      status: row.status,
      createdAt: iso(row.createdAt),
    })),
    abandonedCheckouts: checkouts.map((row) => ({
      email: row.email,
      firstName: row.firstName,
      total: String(row.total),
      currency: row.currency,
      acceptsMarketing: row.acceptsMarketing,
      createdAt: iso(row.createdAt),
      completedAt: iso(row.completedAt),
    })),
    stockAlerts: alerts.map((row) => ({
      email: row.email,
      productId: row.productId,
      variantId: row.variantId,
      status: row.status,
      createdAt: iso(row.createdAt),
      notifiedAt: iso(row.notifiedAt),
    })),
    wheelSpins: spins.map((row) => ({
      email: row.email,
      prize: row.label,
      code: row.code,
      expiresAt: iso(row.expiresAt),
      createdAt: iso(row.createdAt),
    })),
    withdrawals: withdrawals.map((row) => ({
      name: row.name,
      email: row.email,
      orderNumber: row.orderNumber,
      details: row.details,
      status: row.status,
      createdAt: iso(row.createdAt),
    })),
    wishlist: wishlist.map((row) => ({
      productId: row.productId,
      handle: row.handle,
      createdAt: iso(row.createdAt),
    })),
    chats: chats.map((row) => ({
      email: row.email,
      customerId: row.customerId,
      page: row.pagePath,
      status: row.status,
      createdAt: iso(row.createdAt),
      messages: chatMessages
        .filter((message) => message.conversationId === row.id)
        .map((message) => ({
          from: message.author === "merchant" ? "store" : "customer",
          text: message.body,
          at: iso(message.createdAt),
        })),
    })),
  };
}

export type CustomerData = Awaited<ReturnType<typeof customerData>>;

/** নামানো ফাইলে আসলে কিছু আছে কিনা (মার্চেন্টকে "কিছু পাওয়া যায়নি" বলার জন্য) */
export function hasCustomerData(data: CustomerData): boolean {
  return (
    data.subscriber.length +
      data.emails.length +
      data.reviews.length +
      data.abandonedCheckouts.length +
      data.stockAlerts.length +
      data.wheelSpins.length +
      data.withdrawals.length +
      data.wishlist.length +
      data.chats.length >
    0
  );
}

const NOT_SENT = ["queued", "sending"];
/** যে ব্যাকগ্রাউন্ড কাজগুলোর payload-এ ক্রেতার ঠিকানা থাকে, আর payload-এর কোন কোন ঘরে */
const JOBS_WITH_EMAIL = ["shopify-consent", "esp-sync"];
const JOB_EMAIL_PATHS = [["email"], ["contact", "email"], ["event", "email"]];
/** মোছা ক্রেতার পাঠানো ইমেইলের সারিতে ঠিকানার জায়গায় যা থাকে (সারিটা থাকে শুধু গোনার জন্য) */
export const REDACTED = "redacted";

/**
 * এক ক্রেতার সব ব্যক্তিগত তথ্য মোছে। পাঠানো ইমেইলের সারি থাকে (ক্যাম্পেইনের হিসাব আর মাসের সীমা গোনার জন্য),
 * কিন্তু ঠিকানা আর লেখা মুছে যায়; লাইনে থাকা ইমেইল বাদ পড়ে, তাই মোছার পরে তাঁকে আর কিছু যায় না।
 * রিভিউ থাকে, তবে নাম-ইমেইল ছাড়া। দুবার চালালেও ক্ষতি নেই।
 */
export async function redactCustomer(shopId: string, ref: CustomerRef) {
  const { emails, customerId } = await identify(shopId, ref);
  const counts = { deleted: 0, anonymized: 0 };
  if (emails.length > 0) {
    const byEmail = { shopId, email: { in: emails } };
    // প্রত্যাহারের বিবৃতির খবর মার্চেন্টের ঠিকানায় গেছে, কিন্তু তার ভেতরে ক্রেতার নাম-ইমেইল আছে
    const requests = await db.withdrawalRequest.findMany({ where: byEmail, select: { id: true } });
    const mine = {
      shopId,
      OR: [
        { recipient: { in: emails } },
        { kind: "withdrawal", refId: { in: requests.map((row) => `notice:${row.id}`) } },
      ],
    };
    const unsent = await db.message.deleteMany({ where: { ...mine, status: { in: NOT_SENT } } });
    const sent = await db.message.updateMany({
      where: mine,
      data: { recipient: REDACTED, payload: {}, dedupeKey: null, error: null },
    });
    const reviews = await db.review.updateMany({
      where: { shopId, authorEmail: { in: emails } },
      data: { authorEmail: null, authorName: "Customer" },
    });
    const removed = await Promise.all([
      db.subscriber.deleteMany({ where: byEmail }),
      db.abandonedCheckout.deleteMany({ where: byEmail }),
      db.stockAlert.deleteMany({ where: byEmail }),
      db.wheelSpin.deleteMany({ where: byEmail }),
      db.withdrawalRequest.deleteMany({ where: byEmail }),
    ]);
    // Shopify আর ইমেইল টুলে সম্মতি পাঠানোর কাজ: শেষ হওয়ার পরেও সারিগুলো কিছুদিন পড়ে থাকে, ভেতরে ঠিকানাসহ
    const jobs = await db.job.deleteMany({
      where: {
        shopId,
        kind: { in: JOBS_WITH_EMAIL },
        OR: emails.flatMap((email) =>
          JOB_EMAIL_PATHS.map((path) => ({ payload: { path, equals: email } })),
        ),
      },
    });
    counts.deleted +=
      unsent.count + jobs.count + removed.reduce((sum, result) => sum + result.count, 0);
    counts.anonymized += sent.count + reviews.count;
  }
  if (customerId) {
    const wishlist = await db.wishlistItem.deleteMany({
      where: { shopId, owner: `c:${customerId}` },
    });
    counts.deleted += wishlist.count;
  }
  const chats = await chatsOf(shopId, emails, customerId);
  if (chats.length > 0) {
    const ids = chats.map((row) => row.id);
    // মার্চেন্টকে পাঠানো নতুন বার্তার খবরে ক্রেতার ইমেইল আর লেখা থাকে
    const alerts = { shopId, kind: "chat", refId: { in: ids.map((id) => `alert:${id}`) } };
    const unsent = await db.message.deleteMany({ where: { ...alerts, status: { in: NOT_SENT } } });
    const sent = await db.message.updateMany({
      where: alerts,
      data: { recipient: REDACTED, payload: {}, dedupeKey: null, error: null },
    });
    const jobs = await db.job.deleteMany({
      where: {
        shopId,
        kind: { in: ids.flatMap((id) => [`chat-alert:${id}`, `chat-reply:${id}`]) },
      },
    });
    // বার্তাগুলো কথোপকথনের সাথে cascade-এ মুছে যায়
    const removed = await db.chatConversation.deleteMany({ where: { id: { in: ids } } });
    counts.deleted += unsent.count + jobs.count + removed.count;
    counts.anonymized += sent.count;
  }
  return counts;
}
