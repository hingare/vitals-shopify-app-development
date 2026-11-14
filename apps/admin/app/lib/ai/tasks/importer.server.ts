import { z } from "zod";
import { gql } from "../../admin-client.server";
import type { GraphqlClient } from "../../tools.server";
import { generate } from "../claude.server";
import { AiError } from "../errors";
import { registerAiTask } from "../generations.server";
import { fetchPage, type PageFacts } from "../page.server";
import { clip, richTextToHtml } from "../text";
import { notes, merchantNotes, systemPrompt } from "./common.server";

/**
 * AI Product Importer: সাপ্লায়ারের বা নিজের অন্য সাইটের প্রোডাক্ট পেজ থেকে খসড়া প্রোডাক্ট।
 * পেজ আনা হয় নিরাপদ পথে (safe-fetch); বর্ণনা নতুন করে লেখা হয়, হুবহু কপি নয়। প্রোডাক্ট তৈরি হয় DRAFT
 * হিসেবে, তাই ক্রেতারা দেখেন না যতক্ষণ না মার্চেন্ট দেখে প্রকাশ করেন।
 */
const httpsUrl = z
  .string()
  .trim()
  .max(1_000)
  .refine((v) => /^https:\/\//i.test(v), "Use an https link");

export const importOutput = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(6_000),
  vendor: z.string().trim().max(255).default(""),
  productType: z.string().trim().max(255).default(""),
  tags: z.array(z.string().trim().max(60)).max(20).default([]),
  price: z
    .string()
    .trim()
    .regex(/^$|^\d{1,9}(\.\d{1,2})?$/)
    .default(""),
  images: z.array(httpsUrl).max(10).default([]),
});

/** পেজের JSON-LD Product থেকে ছবি আর দাম (AI-কে দেওয়ার আগেই, যাতে বানানো না হয়) */
function productFromJsonLd(page: PageFacts) {
  const found: { images: string[]; price: string; brand: string } = {
    images: [],
    price: "",
    brand: "",
  };
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const type = record["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
      const image = record.image;
      const list = (Array.isArray(image) ? image : [image]).flatMap((i) =>
        typeof i === "string"
          ? [i]
          : i && typeof i === "object" && typeof (i as { url?: unknown }).url === "string"
            ? [(i as { url: string }).url]
            : [],
      );
      found.images.push(...list);
      const offers = record.offers;
      const offer = (Array.isArray(offers) ? offers[0] : offers) as
        Record<string, unknown> | undefined;
      const price = offer?.price ?? offer?.lowPrice;
      if (!found.price && (typeof price === "string" || typeof price === "number"))
        found.price = String(price);
      const brand = record.brand;
      if (!found.brand) {
        found.brand =
          typeof brand === "string"
            ? brand
            : typeof (brand as { name?: unknown })?.name === "string"
              ? (brand as { name: string }).name
              : "";
      }
    }
    if (record["@graph"]) visit(record["@graph"]);
  };
  page.jsonLd.forEach(visit);
  return found;
}

const absolute = (value: string, base: string) => {
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

type UserErrors = Array<{ message: string }>;

async function productStatus(admin: GraphqlClient, id: string) {
  const data = await gql<{ product: { status: string } | null }>(
    admin,
    `#graphql
    query AiImportedProduct($id: ID!) { product(id: $id) { status } }`,
    { id },
  );
  return data.product?.status ?? null;
}

registerAiTask({
  toolId: "ai-product-importer",
  input: z.object({ url: httpsUrl, notes }),
  output: importOutput,
  async run({ shop, input }) {
    const page = await fetchPage(input.url);
    const facts = productFromJsonLd(page);
    const images = [...new Set([...facts.images, page.ogImage].filter(Boolean))]
      .map((src) => absolute(src, page.url))
      .filter((src): src is string => Boolean(src))
      .slice(0, 10);
    const result = await generate({
      shop,
      tier: "smart",
      effort: "low",
      system: await systemPrompt(
        shop.id,
        `You turn a product page from another website into a new product listing for this store.
Write the title and an original description in your own words from the facts on the page; never copy sentences from it. Format the description as plain text with short paragraphs, "- " bullet lines and "## " headings, no HTML.
Use the price only if the page states it, as a plain number like 19.99. Suggest a product type and up to eight tags.`,
      ),
      content: [
        {
          type: "text",
          text: `<page>
URL: ${page.url}
Title: ${page.title}
Description: ${page.metaDescription}
${facts.brand ? `Brand: ${facts.brand}\n` : ""}${facts.price ? `Price on page: ${facts.price}\n` : ""}Headings: ${page.headings.join(" | ")}
Text:
${page.text.slice(0, 6_000)}
</page>${merchantNotes(input.notes)}`,
        },
      ],
      schema: z.object({
        title: z.string(),
        description: z.string(),
        vendor: z.string(),
        productType: z.string(),
        tags: z.array(z.string()),
        price: z.string(),
      }),
      maxTokens: 6_000,
    });
    const price = /^\d{1,9}(\.\d{1,2})?$/.test(result.data.price.trim())
      ? result.data.price.trim()
      : "";
    return {
      output: importOutput.parse({
        title: clip(result.data.title, 255) || clip(page.title, 255) || "Imported product",
        description: result.data.description.trim().slice(0, 6_000),
        vendor: clip(result.data.vendor || facts.brand, 255),
        productType: clip(result.data.productType, 255),
        tags: result.data.tags
          .map((t) => clip(t, 60))
          .filter(Boolean)
          .slice(0, 8),
        price,
        images,
      }),
      costMicros: result.costMicros,
      model: result.model,
    };
  },
  async apply({ admin, output }) {
    const data = await gql<{
      productCreate: {
        product: { id: string; variants: { nodes: Array<{ id: string }> } } | null;
        userErrors: UserErrors;
      } | null;
    }>(
      admin,
      `#graphql
      mutation AiProductImport($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
        productCreate(product: $product, media: $media) {
          product { id variants(first: 1) { nodes { id } } }
          userErrors { message }
        }
      }`,
      {
        product: {
          title: output.title,
          descriptionHtml: richTextToHtml(output.description),
          vendor: output.vendor || undefined,
          productType: output.productType || undefined,
          tags: output.tags,
          status: "DRAFT",
        },
        media: output.images.map((src) => ({
          originalSource: src,
          mediaContentType: "IMAGE",
          alt: output.title,
        })),
      },
    );
    const created = data.productCreate?.product;
    const errors = data.productCreate?.userErrors ?? [];
    if (!created || errors.length > 0) {
      throw new AiError("failed", errors.map((e) => e.message).join("; ") || "productCreate");
    }
    const variant = created.variants.nodes[0];
    if (output.price && variant) {
      await gql(
        admin,
        `#graphql
        mutation AiImportPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { message } }
        }`,
        { productId: created.id, variants: [{ id: variant.id, price: output.price }] },
      ).catch((error: unknown) => console.warn("[ai] import price not set", error));
    }
    return { productId: created.id };
  },
  async undo({ admin, previous }) {
    const { productId } = previous as { productId: string };
    const status = await productStatus(admin, productId);
    if (status === null) return;
    // প্রকাশ করা প্রোডাক্ট কখনো মোছা হয় না
    if (status !== "DRAFT") throw new AiError("changed");
    const data = await gql<{ productDelete: { userErrors: UserErrors } | null }>(
      admin,
      `#graphql
      mutation AiImportDelete($input: ProductDeleteInput!) {
        productDelete(input: $input) { userErrors { message } }
      }`,
      { input: { id: productId } },
    );
    const errors = data.productDelete?.userErrors ?? [];
    if (errors.length > 0) throw new AiError("failed", errors.map((e) => e.message).join("; "));
  },
});
