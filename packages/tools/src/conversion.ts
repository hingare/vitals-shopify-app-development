import { defineTool, themeColors, z } from "@app/tool-sdk";
import { link, text } from "./fields";

/** "আর $১২ কিনলে ফ্রি শিপিং" বার, কার্ট বদলালে সাথে সাথে আপডেট হয় */
export const spendingGoal = defineTool({
  id: "spending-goal",
  category: "upsell",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    goal: z.number().min(1).max(1_000_000).default(50),
    messageEmpty: text(120, "Free shipping on orders over {goal}"),
    messageProgress: text(120, "You're {amount} away from free shipping"),
    messageDone: text(120, "You've unlocked free shipping!"),
    position: z.enum(["top", "bottom"]).default("top"),
    showOnMobile: z.boolean().default(true),
    colors: themeColors({ background: "#F3F4F6", text: "#111827", accent: "#16A34A" }),
  }),
  attribution: ["view"],
});

/** স্টোরের উপরে বা নিচে ঘোষণার বার; ৩টা পর্যন্ত মেসেজ পালা করে দেখায় */
export const announcementBar = defineTool({
  id: "announcement-bar",
  category: "conversion",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    message1: text(150, "Free shipping on all orders"),
    message2: text(150),
    message3: text(150),
    link: link(),
    rotateSeconds: z.number().int().min(2).max(30).default(5),
    position: z.enum(["top", "bottom"]).default("top"),
    sticky: z.boolean().default(false),
    closable: z.boolean().default(true),
    showOnMobile: z.boolean().default(true),
    colors: themeColors({ background: "#111827", text: "#FFFFFF", accent: "#FBBF24" }),
  }),
  attribution: ["view", "click"],
});

/**
 * সেল শেষ হওয়ার সত্যিকারের সময় পর্যন্ত কাউন্টডাউন। সময় স্টোরের টাইমজোনে।
 * নকল (প্রতি ভিজিটরে নতুন করে শুরু হওয়া) টাইমার ইচ্ছা করে রাখা হয়নি: Shopify-র নিয়মে ভুয়া তাড়াহুড়ো দেখানো নিষেধ।
 */
export const countdownTimer = defineTool({
  id: "countdown-timer",
  category: "conversion",
  plan: "starter",
  surfaces: ["product"],
  delivery: "embed",
  settings: z.object({
    endDate: z
      .string()
      .regex(/^$|^\d{4}-\d{2}-\d{2}$/)
      .default(""),
    endTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("23:59"),
    message: text(80, "Sale ends in"),
    colors: themeColors({ background: "#FEF2F2", text: "#111827", accent: "#DC2626" }),
  }),
  attribution: ["view"],
});

/** স্টকে কম থাকলে "আর মাত্র ৩টা বাকি" (Shopify-র আসল ইনভেন্টরি থেকে, বানানো সংখ্যা নয়) */
export const stockScarcity = defineTool({
  id: "stock-scarcity",
  category: "conversion",
  plan: "starter",
  surfaces: ["product"],
  delivery: "embed",
  settings: z.object({
    threshold: z.number().int().min(1).max(100).default(10),
    stockMessage: text(100, "Hurry! Only {n} left in stock"),
    showBar: z.boolean().default(true),
    colors: themeColors({ background: "#FFFFFF", text: "#B91C1C", accent: "#DC2626" }),
  }),
  attribution: ["view"],
});

export const CHAT_CHANNELS = ["whatsapp", "messenger", "telegram", "phone", "email"] as const;

/** ভাসমান চ্যাট বাটন: WhatsApp, Messenger, Telegram, ফোন বা ইমেইল */
export const chatButton = defineTool({
  id: "chat-button",
  category: "conversion",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    channel: z.enum(CHAT_CHANNELS).default("whatsapp"),
    /** ফোন নম্বর (দেশের কোডসহ), পেজ/ইউজারনেম, বা ইমেইল */
    contact: text(120),
    greeting: text(200, "Hi! I have a question."),
    label: text(40, "Chat with us"),
    position: z.enum(["bottom-right", "bottom-left"]).default("bottom-right"),
    showOnMobile: z.boolean().default(true),
    colors: themeColors({ background: "#25D366", text: "#FFFFFF", accent: "#25D366" }),
  }),
  attribution: ["click"],
});

/** পপ-আপ: ইমেইল সাবস্ক্রাইব (Shopify-র নিজের কাস্টমার তালিকায় যায়) বা শুধু অফার দেখানো */
export const popup = defineTool({
  id: "popup",
  category: "conversion",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    trigger: z.enum(["delay", "exit", "scroll"]).default("delay"),
    delaySeconds: z.number().int().min(0).max(120).default(8),
    scrollPercent: z.number().int().min(10).max(100).default(50),
    showOn: z.enum(["everywhere", "home", "product"]).default("everywhere"),
    heading: text(80, "Get 10% off your first order"),
    body: text(300, "Join our list for new arrivals and special offers."),
    collectEmail: z.boolean().default(true),
    buttonText: text(30, "Subscribe"),
    buttonLink: link(),
    discountCode: z
      .string()
      .trim()
      .max(40)
      .regex(/^[A-Za-z0-9_-]*$/)
      .default(""),
    successText: text(150, "Thanks for subscribing!"),
    frequencyDays: z.number().int().min(1).max(365).default(7),
    showOnMobile: z.boolean().default(true),
    colors: themeColors(),
  }),
  attribution: ["view", "click"],
});
