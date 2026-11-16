import { z } from "zod";
import db from "../../../db.server";
import { generate } from "../claude.server";
import { AiError } from "../errors";
import { registerAiTask } from "../generations.server";
import { fetchPage } from "../page.server";
import { loadProduct, productBrief } from "../product.server";
import { loadStore, storeBrief } from "../store.server";
import { merchantNotes, notes, productGid, systemPrompt } from "./common.server";

/**
 * লেখার AI টুল: ফল মার্চেন্ট কপি করে নিজের জায়গায় ব্যবহার করেন, স্টোরে কিছু বসে না।
 * Social Post Writer, Marketing Plan, Viral Campaign, Page Audit।
 */
const PLATFORMS = ["facebook", "instagram", "tiktok", "x"] as const;
const platform = z.enum(PLATFORMS);

async function productText(admin: Parameters<typeof loadProduct>[0], id: string | undefined) {
  return id ? productBrief(await loadProduct(admin, id)) : "";
}

// ---- Social posts ----
export const socialOutput = z.object({
  posts: z
    .array(
      z.object({
        platform,
        text: z.string().trim().min(1).max(2_200),
        hashtags: z.array(z.string().trim().max(60)).max(15),
      }),
    )
    .min(1),
});

registerAiTask({
  toolId: "ai-social-posts",
  input: z
    .object({
      productId: productGid.optional(),
      topic: z.string().trim().max(300).default(""),
      platforms: z.array(platform).min(1).max(4).default(["facebook", "instagram"]),
      goal: z.enum(["launch", "sale", "engagement", "traffic"]).default("traffic"),
      notes,
    })
    .refine((v) => Boolean(v.productId || v.topic), { message: "Choose a product or a topic" }),
  output: socialOutput,
  async run({ shop, admin, input }) {
    const result = await generate({
      shop,
      tier: "fast",
      effort: "low",
      system: await systemPrompt(
        shop.id,
        `You write social media posts for an online store, one post per platform asked for.
Match each platform: Facebook a few friendly sentences; Instagram a caption with line breaks; TikTok a short spoken-style hook and caption; X at most 270 characters including hashtags.
Hashtags go in the hashtags list without the # sign, at most 5 per post, none on X unless they fit. No emoji overload: at most two per post.`,
      ),
      content: [
        {
          type: "text",
          text: `${await productText(admin, input.productId)}${input.topic ? `\nTopic: ${input.topic}` : ""}
Goal: ${input.goal}. Platforms: ${input.platforms.join(", ")}.${merchantNotes(input.notes)}`,
        },
      ],
      schema: z.object({
        posts: z.array(z.object({ platform, text: z.string(), hashtags: z.array(z.string()) })),
      }),
      maxTokens: 3_000,
    });
    const posts = result.data.posts
      .filter((p) => input.platforms.includes(p.platform) && p.text.trim())
      .map((p) => ({
        platform: p.platform,
        text: p.text.trim().slice(0, 2_200),
        hashtags: p.hashtags
          .map((h) => h.replace(/^#/, "").trim())
          .filter(Boolean)
          .slice(0, 15),
      }));
    if (posts.length === 0) throw new AiError("invalid", "No posts");
    return { output: { posts }, costMicros: result.costMicros, model: result.model };
  },
});

// ---- Marketing plan ----
export const planOutput = z.object({
  summary: z.string().trim().min(1),
  weeks: z
    .array(
      z.object({
        title: z.string().trim(),
        focus: z.string().trim(),
        tasks: z.array(
          z.object({ day: z.string().trim(), channel: z.string().trim(), task: z.string().trim() }),
        ),
      }),
    )
    .min(1),
  metrics: z.array(z.string().trim()),
});

registerAiTask({
  toolId: "ai-marketing-plan",
  input: z.object({
    goal: z.enum(["sales", "new-customers", "repeat", "awareness"]).default("sales"),
    budget: z.enum(["none", "small", "medium"]).default("small"),
    channels: z
      .array(z.enum(["email", "social", "ads", "seo", "influencers"]))
      .min(1)
      .default(["email", "social"]),
    notes,
  }),
  output: planOutput,
  async run({ shop, admin, input }) {
    const store = await loadStore(admin);
    const result = await generate({
      shop,
      tier: "smart",
      effort: "medium",
      system: await systemPrompt(
        shop.id,
        `You are a practical e-commerce marketer. Write a 30-day marketing plan in four weeks for this store, using only the channels the owner chose.
Each week has a short title, its focus, and three to six concrete tasks with a day (like "Mon" or "Day 3"), the channel and what exactly to do. Base ideas on the store's real products and numbers. Keep tasks doable by a small team.
End with three to five numbers to watch.`,
      ),
      content: [
        {
          type: "text",
          text: `${await storeBrief(shop.id, store)}
Goal: ${input.goal}. Budget for paid promotion: ${input.budget}. Channels: ${input.channels.join(", ")}.${merchantNotes(input.notes)}`,
        },
      ],
      schema: z.object({
        summary: z.string(),
        weeks: z.array(
          z.object({
            title: z.string(),
            focus: z.string(),
            tasks: z.array(z.object({ day: z.string(), channel: z.string(), task: z.string() })),
          }),
        ),
        metrics: z.array(z.string()),
      }),
      maxTokens: 8_000,
    });
    return {
      output: planOutput.parse(result.data),
      costMicros: result.costMicros,
      model: result.model,
    };
  },
});

// ---- Viral campaign ----
export const campaignOutput = z.object({
  name: z.string().trim().min(1),
  hook: z.string().trim(),
  steps: z.array(z.string().trim()),
  rules: z.array(z.string().trim()),
  posts: z.array(z.object({ platform, text: z.string().trim() })),
  emails: z.array(z.object({ subject: z.string().trim(), body: z.string().trim() })),
});

registerAiTask({
  toolId: "ai-viral-campaign",
  input: z.object({
    productId: productGid.optional(),
    goal: z.enum(["sales", "followers", "emails"]).default("sales"),
    notes,
  }),
  output: campaignOutput,
  async run({ shop, admin, input }) {
    const store = await loadStore(admin);
    const result = await generate({
      shop,
      tier: "smart",
      effort: "medium",
      system: await systemPrompt(
        shop.id,
        `You design a shareable marketing campaign for an online store: a contest, challenge, referral or user-generated content idea that people want to join and share.
Give it a name and a one-line hook, explain how it works in three to six steps, list fair and simple rules (who can join, how a winner is chosen if there is one, when it ends; say "[date]" where the owner must fill in a date), two or three social posts, and two short emails (announcement and reminder).
The campaign must follow platform rules: never require sharing or tagging friends as a condition to enter on Facebook or Instagram, and no fake scarcity.`,
      ),
      content: [
        {
          type: "text",
          text: `${await storeBrief(shop.id, store)}\n${await productText(admin, input.productId)}
Goal: ${input.goal}.${merchantNotes(input.notes)}`,
        },
      ],
      schema: z.object({
        name: z.string(),
        hook: z.string(),
        steps: z.array(z.string()),
        rules: z.array(z.string()),
        posts: z.array(z.object({ platform, text: z.string() })),
        emails: z.array(z.object({ subject: z.string(), body: z.string() })),
      }),
      maxTokens: 6_000,
    });
    return {
      output: campaignOutput.parse(result.data),
      costMicros: result.costMicros,
      model: result.model,
    };
  },
});

// ---- Page audit ----
export const auditOutput = z.object({
  score: z.number().int().min(0).max(100),
  summary: z.string().trim(),
  issues: z.array(
    z.object({
      priority: z.enum(["high", "medium", "low"]),
      area: z.enum(["seo", "conversion", "content", "trust", "accessibility"]),
      problem: z.string().trim(),
      fix: z.string().trim(),
    }),
  ),
});

/** দোকানের নিজের ঠিকানা কিনা (অন্যের সাইট অডিট করা হয় না) */
export function storePageUrl(raw: string, domains: string[]): string | null {
  const value = raw.trim();
  const host = domains[0];
  if (!host) return null;
  try {
    const url = new URL(value.startsWith("/") ? `https://${host}${value}` : value);
    if (url.protocol !== "https:" || !domains.includes(url.hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

registerAiTask({
  toolId: "ai-page-audit",
  input: z.object({ url: z.string().trim().min(1).max(500) }),
  output: auditOutput,
  async run({ shop, admin, input }) {
    const store = await loadStore(admin);
    const url = storePageUrl(input.url, store.domains);
    if (!url) throw new AiError("invalid", "Not a page of this store");
    const page = await fetchPage(url);
    const reviewsOn = await db.toolSetting.findFirst({
      where: { shopId: shop.id, toolId: "product-reviews", enabled: true },
    });
    const result = await generate({
      shop,
      tier: "smart",
      effort: "medium",
      system: await systemPrompt(
        shop.id,
        `You audit one page of an online store for search visibility (Google and AI assistants) and for conversion.
Score the page from 0 to 100 and list the most useful fixes first, at most ten, each with the problem in one sentence and a concrete fix the owner can do in Shopify. Judge only from the facts given; when something can't be judged from them, leave it out.`,
      ),
      content: [
        {
          type: "text",
          text: `<page>
URL: ${page.url}
Title tag: ${page.title || "(none)"}
Meta description: ${page.metaDescription || "(none)"}
Canonical: ${page.canonical || "(none)"}
Headings: ${page.headings.join(" | ") || "(none)"}
Images: ${page.images}, without alt text: ${page.imagesWithoutAlt}
Structured data types: ${page.jsonLdTypes.join(", ") || "(none)"}
Words of visible text: ${page.words}
Visible text:
${page.text}
</page>
Product reviews app is ${reviewsOn ? "on" : "off"}.`,
        },
      ],
      schema: z.object({
        score: z.number(),
        summary: z.string(),
        issues: z.array(
          z.object({
            priority: z.enum(["high", "medium", "low"]),
            area: z.enum(["seo", "conversion", "content", "trust", "accessibility"]),
            problem: z.string(),
            fix: z.string(),
          }),
        ),
      }),
      maxTokens: 6_000,
    });
    return {
      output: auditOutput.parse({
        ...result.data,
        score: Math.round(Math.min(100, Math.max(0, result.data.score))),
        issues: result.data.issues.slice(0, 10),
      }),
      costMicros: result.costMicros,
      model: result.model,
    };
  },
});
