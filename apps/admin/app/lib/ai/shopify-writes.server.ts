import { gql } from "../admin-client.server";
import type { GraphqlClient } from "../tools.server";
import { AiError } from "./errors";

/** AI টুলগুলোর স্টোরে লেখার কাজ এক জায়গায়, Shopify-র userErrors সহ */
type UserErrors = Array<{ field?: string[] | null; message: string }>;

function check(errors: UserErrors | undefined, label: string) {
  if (errors && errors.length > 0) {
    throw new AiError("failed", `${label}: ${errors.map((e) => e.message).join("; ")}`);
  }
}

export async function updateProductCopy(
  admin: GraphqlClient,
  id: string,
  fields: { descriptionHtml?: string; seo?: { title: string; description: string } },
) {
  const data = await gql<{ productUpdate: { userErrors: UserErrors } | null }>(
    admin,
    `#graphql
    mutation AiProductCopy($product: ProductUpdateInput!) {
      productUpdate(product: $product) { userErrors { field message } }
    }`,
    { product: { id, ...fields } },
  );
  check(data.productUpdate?.userErrors, "productUpdate");
}

export async function setImageAlt(admin: GraphqlClient, mediaId: string, alt: string) {
  const data = await gql<{ fileUpdate: { userErrors: UserErrors } | null }>(
    admin,
    `#graphql
    mutation AiImageAlt($files: [FileUpdateInput!]!) {
      fileUpdate(files: $files) { userErrors { field message } }
    }`,
    { files: [{ id: mediaId, alt }] },
  );
  check(data.fileUpdate?.userErrors, "fileUpdate");
}

export async function currentImageAlt(
  admin: GraphqlClient,
  mediaId: string,
): Promise<string | null> {
  const data = await gql<{ node: { alt?: string | null } | null }>(
    admin,
    `#graphql
    query AiImageAltNow($id: ID!) { node(id: $id) { ... on MediaImage { alt } } }`,
    { id: mediaId },
  );
  return data.node ? (data.node.alt ?? "") : null;
}

/**
 * অ্যাপের নিজের metafield ($app নামস্থান, শুধু এই অ্যাপ লিখতে পারে), থিমের ব্লক Liquid দিয়ে পড়ে।
 * কোন key কী তা shopify.app.toml-এ ঘোষণা করা থাকে (যেমন product.metafields.app.ai_faq)।
 */
const APP_NAMESPACE = "$app";
export async function setAppMetafield(
  admin: GraphqlClient,
  ownerId: string,
  key: string,
  value: unknown,
) {
  const data = await gql<{ metafieldsSet: { userErrors: UserErrors } | null }>(
    admin,
    `#graphql
    mutation AiMetafieldSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }`,
    {
      metafields: [
        { ownerId, namespace: APP_NAMESPACE, key, type: "json", value: JSON.stringify(value) },
      ],
    },
  );
  check(data.metafieldsSet?.userErrors, "metafieldsSet");
}

export async function readAppMetafield(
  admin: GraphqlClient,
  ownerId: string,
  key: string,
): Promise<unknown> {
  const data = await gql<{ node: { metafield?: { jsonValue: unknown } | null } | null }>(
    admin,
    `#graphql
    query AiMetafieldRead($id: ID!, $key: String!) {
      node(id: $id) { ... on Product { metafield(namespace: "$app", key: $key) { jsonValue } } }
    }`,
    { id: ownerId, key },
  );
  return data.node?.metafield?.jsonValue ?? null;
}

export async function deleteAppMetafield(admin: GraphqlClient, ownerId: string, key: string) {
  const data = await gql<{ metafieldsDelete: { userErrors: UserErrors } | null }>(
    admin,
    `#graphql
    mutation AiMetafieldDelete($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) { userErrors { field message } }
    }`,
    { metafields: [{ ownerId, namespace: APP_NAMESPACE, key }] },
  );
  check(data.metafieldsDelete?.userErrors, "metafieldsDelete");
}
