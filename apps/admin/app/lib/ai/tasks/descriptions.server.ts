import { z } from "zod";
import { generate } from "../claude.server";
import { AiError } from "../errors";
import { registerAiTask } from "../generations.server";
import { loadProduct, productBrief, smallImage } from "../product.server";
import { updateProductCopy } from "../shopify-writes.server";
import { clip, richTextToHtml } from "../text";
import { merchantNotes, notes, productGid, systemPrompt } from "./common.server";

/**
 * AI Product Descriptions: প্রোডাক্টের তথ্য আর প্রথম ছবি দেখে বর্ণনা লেখে, চাইলে SEO টাইটেল ও বর্ণনাও।
 * মার্চেন্ট আগে দেখেন আর বদলাতে পারেন; "বসাও" চাপলে তবেই প্রোডাক্টে যায়, আগেরটা রাখা থাকে।
 */
const LENGTHS = { short: "40 to 70 words", medium: "90 to 150 words", long: "180 to 280 words" };

const input = z.object({
  productId: productGid,
  length: z.enum(["short", "medium", "long"]).default("medium"),
  includeSeo: z.boolean().default(true),
  notes,
});

export const descriptionOutput = z.object({
  description: z.string().trim().min(1).max(6_000),
  seoTitle: z.string().trim().max(70).default(""),
  seoDescription: z.string().trim().max(320).default(""),
});

const answer = z.object({
  description: z.string(),
  seoTitle: z.string(),
  seoDescription: z.string(),
});

const TASK = `You write product descriptions for an online store.
Format the description as plain text: short paragraphs separated by a blank line, "- " at the start of each bullet line, "## " for a heading, **bold** for a few key words. No HTML, no emoji.
Lead with what the product is and who it is for, then the benefits that follow from the facts given, then practical details such as sizes or care when they are known.
The SEO title is at most 60 characters and names the product. The SEO description is at most 155 characters and reads naturally.`;

interface Previous {
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
  written: string;
}

registerAiTask({
  toolId: "ai-descriptions",
  input,
  output: descriptionOutput,
  async run({ shop, admin, input: request }) {
    const product = await loadProduct(admin, request.productId);
    const image = product.images[0];
    const result = await generate({
      shop,
      tier: "smart",
      effort: "low",
      system: await systemPrompt(shop.id, TASK),
      content: [
        {
          type: "text",
          text: `${productBrief(product)}\n\nWrite a ${LENGTHS[request.length]} description${
            request.includeSeo
              ? " and an SEO title and description"
              : ". Leave the SEO fields empty"
          }.${merchantNotes(request.notes)}`,
        },
        ...(image ? [{ type: "image" as const, url: smallImage(image.url) }] : []),
      ],
      schema: answer,
      maxTokens: 4_000,
    });
    return {
      output: {
        description: result.data.description.trim(),
        seoTitle: request.includeSeo ? clip(result.data.seoTitle, 70) : "",
        seoDescription: request.includeSeo ? clip(result.data.seoDescription, 320) : "",
      },
      costMicros: result.costMicros,
      model: result.model,
    };
  },
  async apply({ admin, input: request, output }) {
    const product = await loadProduct(admin, request.productId);
    const descriptionHtml = richTextToHtml(output.description);
    const seo =
      output.seoTitle || output.seoDescription
        ? {
            title: output.seoTitle || product.seoTitle,
            description: output.seoDescription || product.seoDescription,
          }
        : undefined;
    await updateProductCopy(admin, request.productId, { descriptionHtml, ...(seo ? { seo } : {}) });
    const previous: Previous = {
      descriptionHtml: product.descriptionHtml,
      seoTitle: product.seoTitle,
      seoDescription: product.seoDescription,
      written: descriptionHtml,
    };
    return previous;
  },
  async undo({ admin, input: request, previous }) {
    const before = previous as Previous;
    const product = await loadProduct(admin, request.productId);
    // মার্চেন্ট পরে নিজে বদলে থাকলে তাঁর লেখা মোছা হয় না
    if (normalize(product.descriptionHtml) !== normalize(before.written)) {
      throw new AiError("changed");
    }
    await updateProductCopy(admin, request.productId, {
      descriptionHtml: before.descriptionHtml,
      seo: { title: before.seoTitle, description: before.seoDescription },
    });
  },
});

/** Shopify HTML সামান্য বদলে রাখতে পারে (ফাঁকা জায়গা), তাই তুলনার আগে মেলানো */
const normalize = (html: string) => html.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
