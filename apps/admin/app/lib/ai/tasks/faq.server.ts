import { z } from "zod";
import { generate } from "../claude.server";
import { AiError } from "../errors";
import { registerAiTask } from "../generations.server";
import { loadProduct, productBrief } from "../product.server";
import { deleteAppMetafield, readAppMetafield, setAppMetafield } from "../shopify-writes.server";
import { clip } from "../text";
import { merchantNotes, notes, productGid, systemPrompt } from "./common.server";

/**
 * AI Product FAQ: প্রোডাক্টের তথ্য থেকে প্রশ্ন-উত্তর। বসালে প্রোডাক্টের metafield ($app:ai.faq)-এ যায়,
 * থিমের "AI FAQ" ব্লক সেটা সার্ভারেই দেখায় আর FAQ schema দেয় (Google ও AI সার্চ পড়ে)।
 */
export const FAQ_KEY = "ai_faq";

const input = z.object({
  productId: productGid,
  count: z.number().int().min(3).max(8).default(5),
  notes,
});

export const faqOutput = z.object({
  items: z
    .array(
      z.object({
        question: z.string().trim().min(3).max(200),
        answer: z.string().trim().min(1).max(1_000),
      }),
    )
    .min(1)
    .max(8),
});

const answer = z.object({
  items: z.array(z.object({ question: z.string(), answer: z.string() })),
});

const TASK = `You write a short FAQ for a product page in an online store.
Pick the questions a shopper is most likely to ask before buying this product, and answer each in one to three plain sentences using only the facts given.
If the facts don't answer a common question (for example shipping times), leave that question out instead of guessing.`;

registerAiTask({
  toolId: "ai-product-faq",
  input,
  output: faqOutput,
  async run({ shop, admin, input: request }) {
    const product = await loadProduct(admin, request.productId);
    const result = await generate({
      shop,
      tier: "fast",
      effort: "low",
      system: await systemPrompt(shop.id, TASK),
      content: [
        {
          type: "text",
          text: `${productBrief(product)}\n\nWrite up to ${request.count} questions and answers.${merchantNotes(request.notes)}`,
        },
      ],
      schema: answer,
      maxTokens: 3_000,
    });
    const items = result.data.items
      .map((item) => ({ question: clip(item.question, 200), answer: clip(item.answer, 1_000) }))
      .filter((item) => item.question.length >= 3 && item.answer.length > 0)
      .slice(0, request.count);
    if (items.length === 0) throw new AiError("invalid", "No usable questions");
    return { output: { items }, costMicros: result.costMicros, model: result.model };
  },
  async apply({ admin, input: request, output }) {
    const previous = await readAppMetafield(admin, request.productId, FAQ_KEY);
    await setAppMetafield(admin, request.productId, FAQ_KEY, { items: output.items });
    return { value: previous };
  },
  async undo({ admin, input: request, previous }) {
    const before = (previous as { value: unknown } | null)?.value ?? null;
    if (before === null) await deleteAppMetafield(admin, request.productId, FAQ_KEY);
    else await setAppMetafield(admin, request.productId, FAQ_KEY, before);
  },
});
