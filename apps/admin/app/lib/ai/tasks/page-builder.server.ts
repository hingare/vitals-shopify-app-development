import { z } from "zod";
import { gql } from "../../admin-client.server";
import type { GraphqlClient } from "../../tools.server";
import { generate } from "../claude.server";
import { AiError } from "../errors";
import { registerAiTask } from "../generations.server";
import { loadStore, storeBrief } from "../store.server";
import { clip, richTextToHtml } from "../text";
import { merchantNotes, notes, systemPrompt } from "./common.server";

/**
 * AI Page Builder: একটা বিষয় দিলে পুরো পেজ। "বসাও" চাপলে স্টোরের Pages-এ লুকানো খসড়া হিসেবে তৈরি হয়;
 * মার্চেন্ট Shopify-তে দেখে নিজে প্রকাশ করেন। ফেরালে খসড়াটা মোছে, যদি সেটা এখনো অপ্রকাশিত আর অপরিবর্তিত থাকে।
 */
export const pageOutput = z.object({
  title: z.string().trim().min(1).max(120),
  sections: z
    .array(z.object({ heading: z.string().trim().max(120), body: z.string().trim().max(4_000) }))
    .min(1)
    .max(10),
});

export function pageHtml(output: z.output<typeof pageOutput>): string {
  return output.sections
    .map(
      (s) =>
        `${s.heading ? richTextToHtml(`## ${s.heading}`) + "\n" : ""}${richTextToHtml(s.body)}`,
    )
    .join("\n");
}

type UserErrors = Array<{ message: string }>;

async function readPage(admin: GraphqlClient, id: string) {
  const data = await gql<{ page: { body: string; isPublished: boolean } | null }>(
    admin,
    `#graphql
    query AiPageRead($id: ID!) { page(id: $id) { body isPublished } }`,
    { id },
  );
  return data.page;
}

registerAiTask({
  toolId: "ai-page-builder",
  input: z.object({
    topic: z.string().trim().min(3).max(300),
    pageType: z
      .enum(["landing", "about", "faq", "size-guide", "shipping", "story"])
      .default("landing"),
    notes,
  }),
  output: pageOutput,
  async run({ shop, admin, input }) {
    const store = await loadStore(admin);
    const result = await generate({
      shop,
      tier: "smart",
      effort: "medium",
      system: await systemPrompt(
        shop.id,
        `You write a complete page for an online store. Give it a title and three to eight sections, each with a heading and body text.
Body text is plain text: short paragraphs separated by a blank line, "- " for bullet lines, **bold** for a few key words. No HTML, no emoji, no placeholders except "[fill in]" where the owner must add a fact you don't have (like a shipping time or an address).`,
      ),
      content: [
        {
          type: "text",
          text: `${await storeBrief(shop.id, store)}
Page type: ${input.pageType}. Topic: ${input.topic}.${merchantNotes(input.notes)}`,
        },
      ],
      schema: z.object({
        title: z.string(),
        sections: z.array(z.object({ heading: z.string(), body: z.string() })),
      }),
      maxTokens: 10_000,
    });
    const sections = result.data.sections
      .map((s) => ({ heading: clip(s.heading, 120), body: s.body.trim().slice(0, 4_000) }))
      .filter((s) => s.body)
      .slice(0, 10);
    if (sections.length === 0) throw new AiError("invalid", "Empty page");
    return {
      output: { title: clip(result.data.title, 120) || input.topic.slice(0, 120), sections },
      costMicros: result.costMicros,
      model: result.model,
    };
  },
  async apply({ admin, output }) {
    const body = pageHtml(output);
    const data = await gql<{
      pageCreate: { page: { id: string } | null; userErrors: UserErrors } | null;
    }>(
      admin,
      `#graphql
      mutation AiPageCreate($page: PageCreateInput!) {
        pageCreate(page: $page) { page { id } userErrors { message } }
      }`,
      { page: { title: output.title, body, isPublished: false } },
    );
    const errors = data.pageCreate?.userErrors ?? [];
    if (errors.length > 0 || !data.pageCreate?.page) {
      throw new AiError("failed", errors.map((e) => e.message).join("; ") || "pageCreate");
    }
    return { pageId: data.pageCreate.page.id, body };
  },
  async undo({ admin, previous }) {
    const { pageId, body } = previous as { pageId: string; body: string };
    const page = await readPage(admin, pageId);
    if (page) {
      if (page.isPublished || page.body.replace(/\s+/g, "") !== body.replace(/\s+/g, "")) {
        throw new AiError("changed");
      }
      const data = await gql<{ pageDelete: { userErrors: UserErrors } | null }>(
        admin,
        `#graphql
        mutation AiPageDelete($id: ID!) { pageDelete(id: $id) { userErrors { message } } }`,
        { id: pageId },
      );
      const errors = data.pageDelete?.userErrors ?? [];
      if (errors.length > 0) throw new AiError("failed", errors.map((e) => e.message).join("; "));
    }
  },
});
