import { z } from "@app/tool-sdk";
import { FLOW_KEYS, type EmailContent, type FlowKey } from "./email-render";

/**
 * ইমেইলের লেখা আর প্রেরকের সেটিংসের নিয়ম (schema), আর flow-গুলোর ডিফল্ট লেখা।
 * HTML বানানোর অংশ email-render.ts-এ (সেখানে zod নেই, তাই অ্যাডমিনের প্রিভিউ হালকা থাকে)।
 */
export * from "./email-render";

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
  // schema-র ফল আর email-render.ts-এর EmailContent একই আকারের, টাইপ চেকার তা নিশ্চিত করে
}) satisfies z.ZodType<EmailContent>;

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
