import { z } from "zod";
import { generate } from "../claude.server";
import { AiError } from "../errors";
import type { AiTaskContext } from "../generations.server";
import {
  AD_COPY_ESTIMATE,
  BACKGROUND_MODEL,
  BACKGROUND_PRICE,
  EXPAND_MODEL,
  EXPAND_PRICE,
  EXPAND_SHAPES,
  KEEP_PRODUCT,
  MOTION_IDS,
  MOTIONS,
  PRODUCT_SHOT_MODEL,
  PRODUCT_SHOT_PRICE,
  SCENE_IDS,
  SCENES,
  SHOT_INPUT_MAX,
  SHOT_SHAPES,
  UPSCALE_MAX_MICROS,
  UPSCALE_MODEL,
  VIDEO_INPUT_MAX,
  VIDEO_LENGTHS,
  expandPlan,
  productShotPayload,
  sizedImage,
  upscaleAllowed,
  upscalePlan,
  videoModel,
  videoPrice,
  type VideoLength,
} from "../media/models";
import { AD_CTAS } from "../media/output";
import { englishPrompt, registerMediaTask, type MediaInput } from "../media/run.server";
import { loadProduct, productBrief, smallImage } from "../product.server";
import { clip } from "../text";
import { imageGid, merchantNotes, notes, productGid, systemPrompt } from "./common.server";

/**
 * ছবি ও ভিডিওর পাঁচটা AI টুল। প্রতিটা প্রোডাক্টের একটা ছবি নিয়ে কাজ করে, ফল আগে মার্চেন্ট দেখেন, পছন্দ হলে
 * প্রোডাক্টে নতুন ছবি বা ভিডিও হিসেবে যোগ হয় (আগের ছবি বদলায় না), আর চাইলে ফেরানো যায়।
 * দাম আর মডেল app/lib/ai/media/models.ts-এ; কাজের পালা app/lib/ai/media/run.server.ts-এ।
 */
const base = {
  productId: productGid,
  mediaId: imageGid,
  // শুধু অ্যাডমিনে ছোট ছবি দেখানোর জন্য; মডেলকে পাঠানো হয় Shopify থেকে নতুন করে আনা ছবি
  imageUrl: z.string().trim().max(2_000).optional(),
};

async function sourceImage(context: AiTaskContext<MediaInput>) {
  const product = await loadProduct(context.admin, context.input.productId);
  const image = product.images.find((m) => m.id === context.input.mediaId);
  if (!image) throw new AiError("not_found", context.input.mediaId);
  return { product, image };
}

// ---- Background Remover ----
const backgroundInput = z.object({
  ...base,
  background: z.enum(["transparent", "white"]).default("transparent"),
});

registerMediaTask({
  toolId: "ai-background-remover",
  input: backgroundInput,
  estimateMicros: () => BACKGROUND_PRICE,
  async prepare(context) {
    const { image } = await sourceImage(context);
    const input = sizedImage(image.url, image, 2_048);
    return {
      request: {
        model: BACKGROUND_MODEL,
        payload: { image_url: input.url },
        costMicros: BACKGROUND_PRICE,
        kind: "image",
        result: "image",
        ...(context.input.background === "white" ? { flatten: "white" as const } : {}),
      },
    };
  },
});

// ---- Image Enhancer: বড় করা (upscale) বা চারপাশ বাড়ানো (expand) ----
const enhancerInput = z.object({
  ...base,
  mode: z.enum(["upscale", "expand"]).default("upscale"),
  shape: z.enum(EXPAND_SHAPES).default("1:1"),
});

registerMediaTask({
  toolId: "ai-image-enhancer",
  input: enhancerInput,
  estimateMicros: (input) => (input.mode === "upscale" ? UPSCALE_MAX_MICROS : EXPAND_PRICE),
  async prepare(context) {
    const { image } = await sourceImage(context);
    if (context.input.mode === "upscale") {
      if (!upscaleAllowed(image)) throw new AiError("invalid", "The image is already large");
      const plan = upscalePlan(image.url, image);
      return {
        request: {
          model: UPSCALE_MODEL,
          payload: plan.payload,
          costMicros: plan.costMicros,
          kind: "image",
          result: "image",
        },
      };
    }
    const plan = expandPlan(image.url, image, context.input.shape);
    if (!plan) throw new AiError("invalid", "The image already has this shape");
    return {
      request: {
        model: EXPAND_MODEL,
        payload: plan.payload,
        costMicros: plan.costMicros,
        kind: "image",
        result: "image",
      },
    };
  },
});

// ---- AI Photoshoots ----
const photoshootInput = z
  .object({
    ...base,
    scene: z.enum([...SCENE_IDS, "custom"]).default("studio"),
    customScene: z.string().trim().max(300).default(""),
    count: z.number().int().min(1).max(4).default(2),
    shape: z.enum(SHOT_SHAPES).default("square"),
  })
  .refine((v) => v.scene !== "custom" || v.customScene.length >= 3, {
    message: "Describe the scene",
  });

registerMediaTask({
  toolId: "ai-photoshoots",
  input: photoshootInput,
  estimateMicros: (input) => input.count * PRODUCT_SHOT_PRICE,
  async prepare(context) {
    const { image } = await sourceImage(context);
    const { input } = context;
    const scene =
      input.scene === "custom"
        ? await englishPrompt(context.shop, input.customScene, "scene")
        : { text: SCENES[input.scene], costMicros: 0 };
    const source = sizedImage(image.url, image, SHOT_INPUT_MAX);
    return {
      request: {
        model: PRODUCT_SHOT_MODEL,
        payload: productShotPayload(source.url, scene.text, input.count, input.shape),
        costMicros: input.count * PRODUCT_SHOT_PRICE,
        kind: "image",
        result: "images",
      },
      costMicros: scene.costMicros,
    };
  },
});

// ---- Image to Video ----
const videoLength = z.enum(VIDEO_LENGTHS).default("short");

function videoPlan(length: VideoLength) {
  const model = videoModel();
  if (!model) throw new AiError("not_configured", "Unknown AI_VIDEO_MODEL");
  const seconds = model.seconds[length];
  return { model, seconds, costMicros: model.price(seconds) };
}

const videoInput = z
  .object({
    ...base,
    motion: z.enum([...MOTION_IDS, "custom"]).default("push-in"),
    customMotion: z.string().trim().max(300).default(""),
    length: videoLength,
  })
  .refine((v) => v.motion !== "custom" || v.customMotion.length >= 3, {
    message: "Describe the movement",
  });

registerMediaTask({
  toolId: "ai-image-to-video",
  input: videoInput,
  estimateMicros: (input) => videoPrice(input.length)?.micros ?? 0,
  async prepare(context) {
    const { image } = await sourceImage(context);
    const { input } = context;
    const plan = videoPlan(input.length);
    const motion =
      input.motion === "custom"
        ? await englishPrompt(context.shop, input.customMotion, "motion")
        : { text: MOTIONS[input.motion], costMicros: 0 };
    const source = sizedImage(image.url, image, VIDEO_INPUT_MAX);
    return {
      request: {
        model: plan.model.id,
        payload: plan.model.payload(source.url, `${motion.text} ${KEEP_PRODUCT}`, plan.seconds),
        costMicros: plan.costMicros,
        kind: "video",
        result: "video",
      },
      costMicros: motion.costMicros,
    };
  },
});

// ---- Video Ads: ভিডিও আর তার সাথে বিজ্ঞাপনের লেখা ----
const AD_PLATFORMS = ["facebook", "instagram", "tiktok"] as const;
const AD_GOALS = ["sale", "launch", "awareness"] as const;

const adInput = z.object({
  ...base,
  platform: z.enum(AD_PLATFORMS).default("facebook"),
  goal: z.enum(AD_GOALS).default("sale"),
  length: videoLength,
  notes,
});

const adAnswer = z.object({
  motion: z.string(),
  hook: z.string(),
  headline: z.string(),
  primaryText: z.string(),
  cta: z.enum(AD_CTAS),
  hashtags: z.array(z.string()),
});

const AD_TASK = `You plan a short video ad for one product of an online store. The video is made by an AI model from one product photo, so describe only camera and scene movement for it.
Return:
- motion: one English instruction of at most 60 words for the video model: camera and scene movement only. The product must stay unchanged in shape, color and label. No text on screen, no people, no logos added.
- hook: an on-screen text idea for the first second, at most 8 words.
- headline: at most 40 characters.
- primaryText: the ad's main text, at most 3 short sentences, in the style of the platform.
- cta: the best call to action button.
- hashtags: 3 to 6 hashtags without the # sign.`;

registerMediaTask({
  toolId: "ai-video-ads",
  input: adInput,
  estimateMicros: (input) => (videoPrice(input.length)?.micros ?? 0) + AD_COPY_ESTIMATE,
  async prepare(context) {
    const { product, image } = await sourceImage(context);
    const { input, shop } = context;
    const plan = videoPlan(input.length);
    const result = await generate({
      shop,
      tier: "smart",
      effort: "low",
      system: await systemPrompt(shop.id, AD_TASK),
      content: [
        {
          type: "text",
          text: `${productBrief(product)}\nPlatform: ${input.platform}\nGoal of the ad: ${input.goal}\nVideo length: ${plan.seconds} seconds${merchantNotes(input.notes)}`,
        },
        { type: "image", url: smallImage(image.url) },
      ],
      schema: adAnswer,
      maxTokens: 3_000,
    });
    const answer = result.data;
    const source = sizedImage(image.url, image, VIDEO_INPUT_MAX);
    const motion = plainMotion(answer.motion);
    return {
      request: {
        model: plan.model.id,
        payload: plan.model.payload(source.url, `${motion} ${KEEP_PRODUCT}`, plan.seconds),
        costMicros: plan.costMicros,
        kind: "video",
        result: "video",
      },
      extra: {
        copy: {
          hook: clip(answer.hook, 120),
          headline: clip(answer.headline, 120),
          primaryText: clip(answer.primaryText, 1_000),
          cta: answer.cta,
          hashtags: answer.hashtags
            .map((tag) => tag.replace(/^#+/, "").trim())
            .filter(Boolean)
            .slice(0, 10)
            .map((tag) => clip(tag, 60)),
        },
      },
      costMicros: result.costMicros,
    };
  },
});

/** Claude-এর লেখা নড়াচড়া ইংরেজি না হলে (বা ফাঁকা হলে) নিরাপদ একটা তৈরি নড়াচড়া */
function plainMotion(text: string): string {
  const clean = clip(text.trim(), 500);
  return clean && /^[\x20-\x7E]*$/.test(clean) ? clean : MOTIONS["push-in"];
}
