/**
 * ছবি আর ভিডিওর AI মডেল (fal.ai-তে চলে)। দাম fal-এর মডেল পেজ থেকে (নভেম্বর ২০২৬), মাইক্রো-ডলারে
 * (১ ডলার = ১০,০০,০০০; মার্চেন্ট দেখেন ক্রেডিটে, ১ ক্রেডিট = ১০,০০০)। কাজ জমার আগে ঠিক এই দাম মাসিক
 * AI বাজেট থেকে ধরে রাখা হয়, তাই দাম বদলালে এখানে বদলান। Bria-র মডেলগুলো শুধু লাইসেন্স করা ছবিতে
 * শেখানো (বাণিজ্যিক ব্যবহারে নিরাপদ), তাই প্রোডাক্টের ছবির কাজে সেগুলো।
 */

/** পটভূমি সরানো (Bria RMBG 2.0): প্রতি ছবি $0.018 */
export const BACKGROUND_MODEL = "fal-ai/bria/background/remove";
export const BACKGROUND_PRICE = 18_000;

/** ছবি বড় ও পরিষ্কার করা (SeedVR2): প্রতি মেগাপিক্সেল $0.001; আমরা ফলের মাপ ধরে হিসাব করি (বেশির দিকে) */
export const UPSCALE_MODEL = "fal-ai/seedvr/upscale/image";
export const UPSCALE_PRICE_PER_MP = 1_000;

/** চারপাশ বাড়িয়ে নতুন মাপ (Bria Expand): প্রতি ছবি $0.04 */
export const EXPAND_MODEL = "fal-ai/bria/expand";
export const EXPAND_PRICE = 40_000;

/** প্রোডাক্ট নতুন দৃশ্যে (Bria Product Shot): প্রতি ছবি $0.04; প্রোডাক্টের আসল অংশ বদলায় না */
export const PRODUCT_SHOT_MODEL = "fal-ai/bria/product-shot";
export const PRODUCT_SHOT_PRICE = 40_000;

export interface Size {
  width: number;
  height: number;
}

/** Shopify-র ছবির মাপ (কখনো জানা থাকে না) */
export type MaybeSize = { width?: number | null; height?: number | null } | null;

/**
 * Shopify CDN-এর ছবি দরকারি মাপে: লম্বা দিকটা `max` পর্যন্ত ছোট করে (ছোট ছবি বড় করা হয় না)।
 * মাপ জানা না থাকলে বর্গ ধরে নেওয়া হয় (খরচের হিসাব তাতে বেশির দিকে থাকে)।
 */
export function sizedImage(url: string, size: MaybeSize, max: number): { url: string; size: Size } {
  const width = size?.width && size.width > 0 ? size.width : null;
  const height = size?.height && size.height > 0 ? size.height : null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, size: { width: width ?? max, height: height ?? max } };
  }
  if (!width || !height) {
    parsed.searchParams.set("width", String(max));
    return { url: parsed.toString(), size: { width: max, height: max } };
  }
  const long = Math.max(width, height);
  if (long <= max) return { url, size: { width, height } };
  const scale = max / long;
  const next = { width: Math.round(width * scale), height: Math.round(height * scale) };
  if (width >= height) parsed.searchParams.set("width", String(next.width));
  else parsed.searchParams.set("height", String(next.height));
  return { url: parsed.toString(), size: next };
}

/** এর চেয়ে বড় ছবি আগে থেকেই যথেষ্ট বড়; বড় করার টুল সেগুলো নেয় না */
export const UPSCALE_SOURCE_LIMIT = 3_000;
/** SeedVR2-কে পাঠানো ছবির লম্বা দিক, আর কতগুণ বড় হবে (ফল সর্বোচ্চ ৪০৯৬ পিক্সেল, Shopify-র সীমার ভেতরে) */
export const UPSCALE_INPUT_MAX = 1_024;
export const UPSCALE_FACTOR = 4;

/** বড় করার সবচেয়ে বেশি খরচ: ১০২৪ পিক্সেলের বর্গ ছবি ৪ গুণ = ১৭ মেগাপিক্সেল */
export const UPSCALE_MAX_MICROS =
  Math.ceil((UPSCALE_INPUT_MAX * UPSCALE_FACTOR) ** 2 / 1_000_000) * UPSCALE_PRICE_PER_MP;

export const upscaleAllowed = (size: MaybeSize) =>
  Math.max(size?.width ?? 0, size?.height ?? 0) < UPSCALE_SOURCE_LIMIT;

export function upscalePlan(url: string, size: MaybeSize) {
  const input = sizedImage(url, size, UPSCALE_INPUT_MAX);
  const output = {
    width: input.size.width * UPSCALE_FACTOR,
    height: input.size.height * UPSCALE_FACTOR,
  };
  const megapixels = Math.ceil((output.width * output.height) / 1_000_000);
  return {
    input,
    output,
    costMicros: megapixels * UPSCALE_PRICE_PER_MP,
    payload: {
      image_url: input.url,
      upscale_mode: "factor",
      upscale_factor: UPSCALE_FACTOR,
      // jpg: বড় ছবিও Shopify-র ২০MB সীমার অনেক নিচে থাকে
      output_format: "jpg",
    },
  };
}

/** Bria Expand-এ পাঠানো ছবির লম্বা দিক (ক্যানভাস তাতে ৫০০০×৫০০০-এর অনেক নিচে থাকে) */
export const EXPAND_INPUT_MAX = 1_536;
export const EXPAND_SHAPES = ["1:1", "4:5", "3:4", "16:9", "9:16", "zoom-out"] as const;
export type ExpandShape = (typeof EXPAND_SHAPES)[number];
const RATIOS: Record<Exclude<ExpandShape, "zoom-out">, number> = {
  "1:1": 1,
  "4:5": 4 / 5,
  "3:4": 3 / 4,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};

/** ছবিটা কি আগে থেকেই এই মাপের (তাহলে বাড়ানোর কিছু নেই) */
export function alreadyShape(size: MaybeSize, shape: ExpandShape): boolean {
  if (shape === "zoom-out" || !size?.width || !size.height) return false;
  const ratio = RATIOS[shape];
  return Math.abs(size.width / size.height - ratio) / ratio < 0.02;
}

/**
 * নতুন ক্যানভাসের মাপ আর তার ঠিক মাঝে আসল ছবির জায়গা। মাপ বদলালে শুধু যেদিকে কম সেদিকে বাড়ে;
 * "zoom-out" চারদিকেই ৪০% জায়গা যোগ করে। আগে থেকেই সেই মাপ হলে null।
 */
export function expandPlan(url: string, size: MaybeSize, shape: ExpandShape) {
  if (alreadyShape(size, shape)) return null;
  const input = sizedImage(url, size, EXPAND_INPUT_MAX);
  const { width, height } = input.size;
  let canvas: Size;
  if (shape === "zoom-out") {
    canvas = { width: Math.round(width * 1.4), height: Math.round(height * 1.4) };
  } else {
    const ratio = RATIOS[shape];
    canvas =
      width / height < ratio
        ? { width: Math.round(height * ratio), height }
        : { width, height: Math.round(width / ratio) };
  }
  return {
    input,
    canvas,
    costMicros: EXPAND_PRICE,
    payload: {
      image_url: input.url,
      canvas_size: [canvas.width, canvas.height],
      original_image_size: [width, height],
      original_image_location: [
        Math.floor((canvas.width - width) / 2),
        Math.floor((canvas.height - height) / 2),
      ],
    },
  };
}

/** ফটোশুটের তৈরি দৃশ্য (Bria শুধু ইংরেজি বর্ণনা নেয়) */
export const SCENES = {
  studio:
    "on a seamless white studio backdrop with soft, even lighting and a gentle shadow under the product",
  marble: "on a white marble countertop with soft morning daylight from a window, clean and bright",
  wood: "on a rustic wooden table with warm, natural light and a softly blurred background",
  nature:
    "outdoors on a flat stone surrounded by green leaves, soft sunlight, a blurred forest in the background",
  kitchen: "on a modern kitchen counter with soft daylight and a softly blurred kitchen behind",
  bathroom:
    "on a clean bathroom shelf with white tiles, soft spa-like light and a few green leaves",
  living:
    "on a wooden side table in a cozy, bright living room with a softly blurred sofa in the background",
  beach: "on smooth sand at the beach with the ocean softly blurred behind, warm golden sunlight",
  festive:
    "on a festive table with wrapped gifts and warm, softly blurred string lights in the background",
  pastel:
    "on a round pastel podium in front of a soft pastel color backdrop, minimal and modern, soft shadows",
} as const;
export type Scene = keyof typeof SCENES;
export const SCENE_IDS = [
  "studio",
  "marble",
  "wood",
  "nature",
  "kitchen",
  "bathroom",
  "living",
  "beach",
  "festive",
  "pastel",
] as const satisfies readonly Scene[];

export const SHOT_SHAPES = ["square", "portrait"] as const;
export type ShotShape = (typeof SHOT_SHAPES)[number];
/** Bria-কে পাঠানো ছবির লম্বা দিক (তাদের সীমা ১২MB) */
export const SHOT_INPUT_MAX = 2_000;

export function productShotPayload(
  imageUrl: string,
  scene: string,
  count: number,
  shape: ShotShape,
) {
  return {
    image_url: imageUrl,
    scene_description: scene,
    optimize_description: true,
    num_results: count,
    fast: true,
    // "automatic" অনেকগুলো ফল বানায় (আর প্রতিটার দাম লাগে), তাই নির্দিষ্ট জায়গা: নিচের মাঝখানে
    placement_type: "manual_placement",
    manual_placement_selection: "bottom_center",
    shot_size: shape === "square" ? [1000, 1000] : [1000, 1250],
  };
}

/** ভিডিওর নড়াচড়া (মডেল ইংরেজি বর্ণনায় সবচেয়ে ভালো বোঝে)। প্রোডাক্ট যেন না বদলায়, সেটা প্রতিটাতে বলা। */
export const MOTIONS = {
  "push-in":
    "Slow, smooth camera push-in toward the product. The product itself stays still, sharp and unchanged in shape, color and label. Soft natural light. Professional product video.",
  orbit:
    "The camera slowly moves in a smooth arc around the product. The product itself stays still and unchanged in shape, color and label. Clean studio lighting.",
  light:
    "Soft light slowly sweeps across the product, revealing its details. Very subtle camera movement. The product stays unchanged in shape, color and label.",
  lifestyle:
    "Gentle, natural movement in the scene around the product, such as softly shifting light and subtle background motion. The product stays sharp and unchanged in shape, color and label.",
} as const;
export type Motion = keyof typeof MOTIONS;
export const MOTION_IDS = [
  "push-in",
  "orbit",
  "light",
  "lifestyle",
] as const satisfies readonly Motion[];

/** নিজের লেখা নড়াচড়া বা দৃশ্যের সাথে সবসময় যোগ হয় */
export const KEEP_PRODUCT =
  "The product must stay unchanged in shape, color, label and proportions.";

export const VIDEO_LENGTHS = ["short", "long"] as const;
export type VideoLength = (typeof VIDEO_LENGTHS)[number];
/** ভিডিওর জন্য ছবির লম্বা দিক */
export const VIDEO_INPUT_MAX = 1_920;

export interface VideoModel {
  key: string;
  id: string;
  seconds: Record<VideoLength, number>;
  price(seconds: number): number;
  payload(imageUrl: string, prompt: string, seconds: number): Record<string, unknown>;
}

/**
 * ভিডিও মডেল: .env-এর AI_VIDEO_MODEL দিয়ে বাছা যায় ("kling" আগে থেকে ঠিক করা, বা "ltx")।
 * Kling 2.1 Standard: ৫ সেকেন্ড $0.28, প্রতি বাড়তি সেকেন্ড $0.056। LTX-2 Fast: ১০৮০p, প্রতি সেকেন্ড $0.04।
 */
export const VIDEO_MODELS: Record<string, VideoModel> = {
  kling: {
    key: "kling",
    id: "fal-ai/kling-video/v2.1/standard/image-to-video",
    seconds: { short: 5, long: 10 },
    price: (seconds) => 280_000 + Math.max(0, seconds - 5) * 56_000,
    payload: (imageUrl, prompt, seconds) => ({
      prompt,
      image_url: imageUrl,
      duration: String(seconds),
      negative_prompt: "blur, distort, deformed product, changed label, low quality",
      cfg_scale: 0.5,
    }),
  },
  ltx: {
    key: "ltx",
    id: "fal-ai/ltx-2/image-to-video/fast",
    seconds: { short: 6, long: 10 },
    price: (seconds) => seconds * 40_000,
    payload: (imageUrl, prompt, seconds) => ({
      image_url: imageUrl,
      prompt,
      duration: seconds,
      resolution: "1080p",
      fps: 25,
      generate_audio: false,
    }),
  },
};

export function videoModel(env: NodeJS.ProcessEnv = process.env): VideoModel | null {
  const key = env.AI_VIDEO_MODEL?.trim() || "kling";
  return Object.hasOwn(VIDEO_MODELS, key) ? (VIDEO_MODELS[key] as VideoModel) : null;
}

/** ভিডিওর দাম (মাইক্রো-ডলারে); মডেল ঠিক না থাকলে null */
export function videoPrice(length: VideoLength, env: NodeJS.ProcessEnv = process.env) {
  const model = videoModel(env);
  if (!model) return null;
  const seconds = model.seconds[length];
  return { seconds, micros: model.price(seconds) };
}

/** ফর্মে শুরুর আগেই দেখানো দাম, ক্রেডিটে (আর ভিডিওর দৈর্ঘ্য, সেকেন্ডে) */
export interface MediaPrices {
  credits: Record<string, number>;
  seconds: Record<string, number> | null;
}

/** বিজ্ঞাপনের লেখার আনুমানিক খরচ (শুরুর আগে ক্রেডিট আছে কিনা দেখতে আর দাম দেখাতে; আসল খরচ পরে মেলে) */
export const AD_COPY_ESTIMATE = 30_000;

/** শুধু সাধারণ ইংরেজি অক্ষর থাকলে লেখাটা সরাসরি মডেলকে দেওয়া যায় (নইলে আগে ইংরেজিতে লেখানো হয়) */
export const plainEnglish = (text: string) => /^[\x20-\x7E\n\r\t]*$/.test(text);
