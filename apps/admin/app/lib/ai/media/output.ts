import { z } from "zod";

/**
 * ছবি ও ভিডিওর AI কাজের ফল: আমাদের স্টোরেজে রাখা ফাইলের তালিকা (fal-এর ঠিকানা নয়, সেগুলো এক দিন পরে মুছে যায়)।
 * মার্চেন্ট বসানোর আগে শুধু কোন ফাইলগুলো প্রোডাক্টে যাবে (`selected`) বাছেন; ফাইলের নাম তিনি বদলাতে
 * পারেন না (বসানোর সময় সার্ভার আবার মিলিয়ে দেখে)।
 */
export const MEDIA_MIMES = ["image/png", "image/jpeg", "image/webp", "video/mp4"] as const;
export type MediaMime = (typeof MEDIA_MIMES)[number];

/** আমাদের স্টোরেজে ফাইলের নাম: ai-media/<দোকান>/<কাজ>/<ক্রম>.<ধরন> (files.server.ts-এর storeMediaFiles) */
export const MEDIA_KEY = /^ai-media\/[\w-]+\/[\w-]+\/[0-3]\.(png|jpg|webp|mp4)$/;

export const mediaFileSchema = z.object({
  key: z.string().max(300).regex(MEDIA_KEY),
  type: z.enum(["image", "video"]),
  mime: z.enum(MEDIA_MIMES),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
export type MediaFile = z.infer<typeof mediaFileSchema>;

/** বিজ্ঞাপনের লেখা (Video Ads) */
export const AD_CTAS = ["shop_now", "learn_more", "order_now", "get_offer", "sign_up"] as const;
export const adCopySchema = z.object({
  hook: z.string().trim().max(120),
  headline: z.string().trim().max(120),
  primaryText: z.string().trim().max(1_000),
  cta: z.enum(AD_CTAS),
  hashtags: z.array(z.string().trim().max(60)).max(10),
});
export type AdCopy = z.infer<typeof adCopySchema>;

export const mediaOutput = z.object({
  files: z.array(mediaFileSchema).min(1).max(4),
  /** প্রোডাক্টে কোন ফাইলগুলো যাবে (files-এর ক্রমিক নম্বর) */
  selected: z.array(z.number().int().min(0).max(3)).max(4).default([0]),
  /** ফাইলগুলো রাখার মেয়াদ (৩০ দিন) শেষ, মুছে ফেলা হয়েছে */
  expired: z.boolean().default(false),
  copy: adCopySchema.optional(),
});
export type MediaOutput = z.infer<typeof mediaOutput>;

export const MEDIA_RETENTION_DAYS = 30;
