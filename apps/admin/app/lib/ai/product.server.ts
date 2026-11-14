import { gql } from "../admin-client.server";
import type { GraphqlClient } from "../tools.server";
import { AiError } from "./errors";
import { htmlToText } from "./text";

/** AI-কে পাঠানোর জন্য প্রোডাক্টের দরকারি তথ্য (Admin API থেকে) */
export interface ProductContext {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
  descriptionHtml: string;
  descriptionText: string;
  seoTitle: string;
  seoDescription: string;
  options: Array<{ name: string; values: string[] }>;
  price: { min: string; max: string; currency: string } | null;
  images: Array<{
    id: string;
    url: string;
    alt: string;
    width: number | null;
    height: number | null;
  }>;
}

const PRODUCT_QUERY = `#graphql
  query AiProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      vendor
      productType
      tags
      descriptionHtml
      seo { title description }
      options { name optionValues { name } }
      priceRangeV2 {
        minVariantPrice { amount currencyCode }
        maxVariantPrice { amount currencyCode }
      }
      media(first: 20) {
        nodes {
          ... on MediaImage { id alt image { url width height } }
        }
      }
    }
  }`;

interface ProductResponse {
  product: {
    id: string;
    title: string;
    handle: string;
    vendor: string | null;
    productType: string | null;
    tags: string[];
    descriptionHtml: string | null;
    seo: { title: string | null; description: string | null };
    options: Array<{ name: string; optionValues: Array<{ name: string }> }>;
    priceRangeV2: {
      minVariantPrice: { amount: string; currencyCode: string };
      maxVariantPrice: { amount: string; currencyCode: string };
    } | null;
    media: {
      nodes: Array<{
        id?: string;
        alt?: string | null;
        image?: { url: string; width?: number | null; height?: number | null } | null;
      }>;
    };
  } | null;
}

export async function loadProduct(admin: GraphqlClient, id: string): Promise<ProductContext> {
  const data = await gql<ProductResponse>(admin, PRODUCT_QUERY, { id });
  const product = data.product;
  if (!product) throw new AiError("not_found", `Product ${id}`);
  const html = product.descriptionHtml ?? "";
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    vendor: product.vendor ?? "",
    productType: product.productType ?? "",
    tags: product.tags,
    descriptionHtml: html,
    descriptionText: htmlToText(html),
    seoTitle: product.seo.title ?? "",
    seoDescription: product.seo.description ?? "",
    options: product.options
      .filter((o) => !(o.name === "Title" && o.optionValues.length === 1))
      .map((o) => ({ name: o.name, values: o.optionValues.map((v) => v.name) })),
    price: product.priceRangeV2
      ? {
          min: product.priceRangeV2.minVariantPrice.amount,
          max: product.priceRangeV2.maxVariantPrice.amount,
          currency: product.priceRangeV2.minVariantPrice.currencyCode,
        }
      : null,
    images: product.media.nodes.flatMap((m) =>
      m.id && m.image
        ? [
            {
              id: m.id,
              url: m.image.url,
              alt: m.alt ?? "",
              width: m.image.width ?? null,
              height: m.image.height ?? null,
            },
          ]
        : [],
    ),
  };
}

/** Shopify CDN-এর ছবি ছোট মাপে (AI-র টোকেন আর খরচ কম) */
export function smallImage(url: string, width = 800): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("width", String(width));
    return parsed.toString();
  } catch {
    return url;
  }
}

/** প্রোডাক্টের তথ্য প্রম্পটের জন্য, <store_data> ট্যাগের ভেতরে */
export function productBrief(product: ProductContext): string {
  const lines = [
    `Title: ${product.title}`,
    product.vendor && `Brand: ${product.vendor}`,
    product.productType && `Type: ${product.productType}`,
    product.tags.length > 0 && `Tags: ${product.tags.slice(0, 20).join(", ")}`,
    product.price &&
      (product.price.min === product.price.max
        ? `Price: ${product.price.min} ${product.price.currency}`
        : `Price: ${product.price.min} to ${product.price.max} ${product.price.currency}`),
    ...product.options.map((o) => `${o.name}: ${o.values.slice(0, 20).join(", ")}`),
    product.descriptionText && `Current description:\n${product.descriptionText}`,
  ].filter(Boolean);
  return `<store_data>\n${lines.join("\n")}\n</store_data>`;
}
