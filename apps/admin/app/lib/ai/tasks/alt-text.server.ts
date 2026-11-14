import { z } from "zod";
import { generate } from "../claude.server";
import { AiError } from "../errors";
import { registerAiTask } from "../generations.server";
import { loadProduct, smallImage } from "../product.server";
import { currentImageAlt, setImageAlt } from "../shopify-writes.server";
import { clip } from "../text";
import { imageGid, productGid, systemPrompt } from "./common.server";

/**
 * AI Alt Text: প্রোডাক্টের ছবি দেখে বর্ণনামূলক alt লেখে। মার্চেন্ট দেখে তারপর বসান;
 * আগের alt রাখা থাকে, আর ফেরানোর সময় পরে বদলানো alt ছোঁয়া হয় না।
 */
const input = z.object({
  productId: productGid,
  mediaId: imageGid,
  // শুধু অ্যাডমিনে ছোট ছবি দেখানোর জন্য; AI-কে পাঠানো হয় Shopify থেকে নতুন করে আনা ছবি
  imageUrl: z.string().trim().max(2_000).optional(),
});
export const altOutput = z.object({ alt: z.string().trim().min(1).max(512) });
const answer = z.object({ alt: z.string() });

const TASK = `You write alt text for product photos in an online store.
Describe what the photo shows in one plain sentence of at most 125 characters: the product, its color and material when visible, and what it is doing or where it is. Use the product name when it helps. Do not start with "Image of" or "Photo of". Do not add claims that are not visible.`;

interface Previous {
  alt: string;
  written: string;
}

registerAiTask({
  toolId: "ai-alt-text",
  input,
  output: altOutput,
  async run({ shop, admin, input: request }) {
    const product = await loadProduct(admin, request.productId);
    const image = product.images.find((m) => m.id === request.mediaId);
    if (!image) throw new AiError("not_found", request.mediaId);
    const result = await generate({
      shop,
      tier: "fast",
      effort: "low",
      system: await systemPrompt(shop.id, TASK),
      content: [
        {
          type: "text",
          text: `<store_data>\nProduct: ${product.title}${product.vendor ? `\nBrand: ${product.vendor}` : ""}\n</store_data>`,
        },
        { type: "image", url: smallImage(image.url) },
      ],
      schema: answer,
      maxTokens: 1_000,
    });
    return {
      output: { alt: clip(result.data.alt, 512) },
      costMicros: result.costMicros,
      model: result.model,
    };
  },
  async apply({ admin, input: request, output }) {
    const before = await currentImageAlt(admin, request.mediaId);
    if (before === null) throw new AiError("not_found", request.mediaId);
    await setImageAlt(admin, request.mediaId, output.alt);
    const previous: Previous = { alt: before, written: output.alt };
    return previous;
  },
  async undo({ admin, input: request, previous }) {
    const before = previous as Previous;
    const now = await currentImageAlt(admin, request.mediaId);
    if (now === null) throw new AiError("not_found", request.mediaId);
    if (now !== before.written) throw new AiError("changed");
    await setImageAlt(admin, request.mediaId, before.alt);
  },
});
