import { defineTool, themeColors, z } from "@app/tool-sdk";
import { text } from "./fields";

/**
 * Stage 5: Marketing আর Protect টুল।
 * গোপন চাবি (ইমেইল টুলের API key) কখনো টুলের সেটিংসে থাকে না:
 * সেগুলো Integrations পেজ থেকে এনক্রিপ্ট হয়ে আলাদা টেবিলে যায়।
 */

/** ইমেইল ক্যাম্পেইন আর স্বয়ংক্রিয় ইমেইল। লেখা আর সময় Marketing পেজে ঠিক হয়। */
export const emailMarketing = defineTool({
  id: "email-marketing",
  category: "marketing",
  plan: "professional",
  surfaces: ["all"],
  delivery: "admin",
  settings: z.object({
    subscribersOnly: z.boolean().default(true),
  }),
});

/** ব্রাউজারের push নোটিফিকেশন: আগে নিজের ছোট কার্ডে জিজ্ঞেস করে, রাজি হলে তবেই ব্রাউজারের অনুমতি চায় */
export const pushNotifications = defineTool({
  id: "push-notifications",
  category: "marketing",
  plan: "professional",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    promptTitle: text(80, "Get notified about new arrivals and offers"),
    promptBody: text(160, "We send a notification now and then. You can turn it off anytime."),
    allowText: text(30, "Allow"),
    laterText: text(30, "Not now"),
    delaySeconds: z.number().int().min(0).max(120).default(10),
    frequencyDays: z.number().int().min(1).max(365).default(14),
    showOnMobile: z.boolean().default(true),
    colors: themeColors(),
  }),
  attribution: ["view", "click"],
});

/** স্টক শেষ হলে "স্টকে এলে জানাও" বাটন; স্টকে ফিরলে ইমেইল যায় */
export const backInStock = defineTool({
  id: "back-in-stock",
  category: "marketing",
  plan: "professional",
  surfaces: ["product"],
  delivery: "embed",
  settings: z.object({
    notifyText: text(40, "Notify me when available"),
    heading: text(80, "Get an email when this is back in stock"),
    buttonText: text(30, "Notify me"),
    successText: text(160, "Thanks! We'll email you as soon as it's back."),
    offerNewsletter: z.boolean().default(true),
    newsletterText: text(120, "Also send me news and offers"),
    emailSubject: text(150, "{product} is back in stock"),
    emailBody: text(600, "Good news! {product} is available again at {shop}."),
    emailButton: text(40, "View product"),
    colors: themeColors(),
  }),
  attribution: ["view", "click"],
});

const slice = (prize: string, percentOff: number, chance: number) =>
  z
    .object({
      prize: text(24, prize),
      percentOff: z.number().int().min(0).max(100).default(percentOff),
      chance: z.number().int().min(0).max(100).default(chance),
    })
    .default({ prize, percentOff, chance });

/**
 * ইমেইল দিয়ে চাকা ঘোরালে ছাড়ের কোড। ফল সার্ভারে ঠিক হয়, আর প্রতিটা ঘরের মাপ তার আসল সম্ভাবনার সমান:
 * ক্রেতা যা দেখে সেটাই আসল সুযোগ। কোড প্রতি ক্রেতার জন্য আলাদা আর তার মেয়াদ সত্যিকারের।
 */
export const spinWheel = defineTool({
  id: "spin-wheel",
  category: "marketing",
  plan: "professional",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    trigger: z.enum(["delay", "exit", "scroll"]).default("delay"),
    delaySeconds: z.number().int().min(0).max(120).default(8),
    scrollPercent: z.number().int().min(5).max(100).default(50),
    showOn: z.enum(["everywhere", "home", "product"]).default("everywhere"),
    heading: text(80, "Spin to win a discount"),
    body: text(200, "Enter your email and spin the wheel. One spin per person."),
    buttonText: text(30, "Spin"),
    consentText: text(
      240,
      "By entering your email you agree to receive marketing emails. You can unsubscribe at any time.",
    ),
    slice1: slice("5% off", 5, 30),
    slice2: slice("No prize", 0, 25),
    slice3: slice("10% off", 10, 20),
    slice4: slice("No prize", 0, 10),
    slice5: slice("15% off", 15, 10),
    slice6: slice("20% off", 20, 5),
    codeValidDays: z.number().int().min(1).max(60).default(3),
    frequencyDays: z.number().int().min(1).max(365).default(7),
    showOnMobile: z.boolean().default(true),
    colors: themeColors({ accent: "#DC2626" }),
  }),
  attribution: ["view", "click"],
});

/** পছন্দের প্রোডাক্ট জমিয়ে রাখা; লগইন করা ক্রেতার তালিকা সব ডিভাইসে একই থাকে */
export const wishlist = defineTool({
  id: "wishlist",
  category: "marketing",
  plan: "professional",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    addText: text(40, "Add to wishlist"),
    addedText: text(40, "In your wishlist"),
    title: text(60, "Your wishlist"),
    emptyText: text(160, "Nothing saved yet. Tap the heart on a product to save it."),
    showLauncher: z.boolean().default(true),
    launcherSide: z.enum(["left", "right"]).default("right"),
    colors: themeColors({ accent: "#E11D48" }),
  }),
  attribution: ["click", "add_to_cart"],
});

/** অর্ডার নম্বর আর ইমেইল/ফোন দিয়ে অর্ডারের অবস্থা দেখা: /apps/app-tools/track */
export const orderTracker = defineTool({
  id: "order-tracker",
  category: "marketing",
  plan: "professional",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    heading: text(80, "Track your order"),
    body: text(200, "Enter your order number and the email or phone number you used to order."),
    buttonText: text(30, "Track order"),
    notFoundText: text(
      200,
      "We couldn't find an order with those details. Please check them and try again.",
    ),
    showInFooter: z.boolean().default(true),
    linkText: text(60, "Track your order"),
    colors: themeColors(),
  }),
  attribution: ["view", "click"],
});

/** প্রোডাক্টের ছবিতে alt লেখা না থাকলে নিয়ম অনুযায়ী বসায় (Google Images ও স্ক্রিন রিডারের জন্য) */
export const seoAltTags = defineTool({
  id: "seo-alt-tags",
  category: "marketing",
  plan: "professional",
  surfaces: ["all"],
  delivery: "admin",
  settings: z.object({
    altTemplate: text(160, "{product} - {shop}"),
    autoNew: z.boolean().default(true),
  }),
});

const pixelId = () =>
  z
    .string()
    .trim()
    .regex(/^$|^\d{8,20}$/)
    .default("");

/** একাধিক Meta (Facebook) Pixel: Shopify-র web pixel দিয়ে চলে, ক্রেতার মার্কেটিং সম্মতি মেনে */
export const facebookPixels = defineTool({
  id: "facebook-pixels",
  category: "marketing",
  plan: "professional",
  surfaces: ["all", "checkout"],
  delivery: "pixel",
  settings: z.object({
    pixelId1: pixelId(),
    pixelId2: pixelId(),
    pixelId3: pixelId(),
  }),
});

/**
 * EU-র নিয়ম (Directive 2023/2673, Consumer Rights Directive-এর নতুন Article 11a):
 * অনলাইনে কেনা চুক্তি প্রত্যাহারের বাটন ও ফর্ম। নিয়মে যা লাগে:
 * - সব সময় চোখে পড়ার মতো একটা লিংক, লেখা "withdraw from contract here" বা সমার্থক (linkText)
 * - ফর্মে নাম, চুক্তি চেনার তথ্য (অর্ডার নম্বর) আর প্রাপ্তিস্বীকার পাঠানোর ইমেইল
 * - জমা দেওয়ার বাটন, লেখা "confirm withdrawal" বা সমার্থক (confirmText)
 * - জমা পড়ার সাথে সাথে ক্রেতাকে প্রাপ্তিস্বীকার: কী জমা দিলেন আর কোন তারিখ ও সময়ে (ackSubject, ackBody)
 */
export const euWithdrawal = defineTool({
  id: "eu-withdrawal",
  category: "protect",
  plan: "professional",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    linkText: text(60, "Withdraw from contract here"),
    heading: text(80, "Withdraw from your contract"),
    body: text(
      400,
      "Use this form to withdraw from a purchase. We will confirm by email that we received it.",
    ),
    confirmText: text(40, "Confirm withdrawal"),
    doneText: text(200, "We received your withdrawal. A confirmation is on its way to your email."),
    ackSubject: text(150, "We received your withdrawal"),
    ackBody: text(
      600,
      "Hello {name},\n\nWe received your withdrawal from the contract for order {order}. The details you sent us are below. We will contact you about the next steps.",
    ),
    showInFooter: z.boolean().default(true),
    colors: themeColors(),
  }),
  attribution: ["view", "click"],
});

/** "Best selling" সাজানো লুকায়, যাতে অন্যরা সহজে আপনার সেরা বিক্রির প্রোডাক্ট দেখে না ফেলে */
export const bestSellersProtection = defineTool({
  id: "best-sellers-protection",
  category: "protect",
  plan: "professional",
  surfaces: ["collection"],
  delivery: "embed",
  settings: z.object({
    hideSortOption: z.boolean().default(true),
    redirectVisits: z.boolean().default(true),
  }),
});

/** চাকার ঘর: সেটিংস থেকে সাজানো তালিকা (chance ০ হলে বাদ) */
export interface WheelSlice {
  prize: string;
  percentOff: number;
  chance: number;
}

export function wheelSlices(settings: Record<string, unknown>): WheelSlice[] {
  const out: WheelSlice[] = [];
  for (let i = 1; i <= 6; i++) {
    const s = settings[`slice${i}`] as WheelSlice | undefined;
    if (s && s.chance > 0 && s.prize) out.push(s);
  }
  return out;
}
