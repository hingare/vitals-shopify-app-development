import { gql } from "../../admin-client.server";
import type { GraphqlClient } from "../../tools.server";
import { AiError } from "../errors";

/**
 * AI-র ছবি বা ভিডিও প্রোডাক্টে যোগ করা আর ফেরানো:
 *   ১. stagedUploadsCreate: Shopify-র অস্থায়ী আপলোডের জায়গা (ভিডিওর জন্য এটাই একমাত্র পথ)
 *   ২. সেখানে ফাইল পাঠানো (multipart POST)
 *   ৩. productUpdate-এর media দিয়ে প্রোডাক্টে নতুন media (আগের ছবিগুলো যেমন ছিল তেমনই থাকে)
 * ফেরানোর সময় শুধু আমাদের যোগ করা media মোছা হয় (fileDelete)।
 */
type UserErrors = Array<{ field?: string[] | null; message: string; code?: string | null }>;

type FetchFn = typeof fetch;
let uploadFetch: FetchFn | null = null;

/** টেস্টে নকল আপলোড বসাতে (null দিলে আবার আসলটা) */
export function setUploadFetchForTests(fn: FetchFn | null) {
  uploadFetch = fn;
}

function check(errors: UserErrors | undefined, label: string) {
  if (errors && errors.length > 0) {
    throw new AiError("failed", `${label}: ${errors.map((e) => e.message).join("; ")}`);
  }
}

export async function productMediaIds(admin: GraphqlClient, productId: string): Promise<string[]> {
  const data = await gql<{ product: { media: { nodes: Array<{ id: string }> } } | null }>(
    admin,
    `#graphql
    query AiProductMediaIds($id: ID!) { product(id: $id) { media(first: 250) { nodes { id } } } }`,
    { id: productId },
  );
  if (!data.product) throw new AiError("not_found", productId);
  return data.product.media.nodes.map((node) => node.id);
}

interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
}

/** ফাইলটা Shopify-র অস্থায়ী জায়গায় পাঠায়; প্রোডাক্টে বসানোর ঠিকানা (resourceUrl) ফেরত দেয় */
export async function stageUpload(
  admin: GraphqlClient,
  file: { body: Buffer; mime: string; filename: string; type: "image" | "video" },
): Promise<string> {
  const data = await gql<{
    stagedUploadsCreate: { stagedTargets: StagedTarget[]; userErrors: UserErrors } | null;
  }>(
    admin,
    `#graphql
    mutation AiStagedUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      input: [
        {
          filename: file.filename,
          mimeType: file.mime,
          resource: file.type === "video" ? "VIDEO" : "IMAGE",
          fileSize: String(file.body.length),
          httpMethod: "POST",
        },
      ],
    },
  );
  check(data.stagedUploadsCreate?.userErrors, "stagedUploadsCreate");
  const target = data.stagedUploadsCreate?.stagedTargets[0];
  if (!target?.url || !target.resourceUrl) throw new AiError("failed", "No staged upload target");

  const form = new FormData();
  for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
  // ফাইল সবসময় শেষে (আপলোডের জায়গা তাই চায়)
  form.append("file", new Blob([new Uint8Array(file.body)], { type: file.mime }), file.filename);
  let res: Response;
  try {
    res = await (uploadFetch ?? fetch)(target.url, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(file.type === "video" ? 300_000 : 120_000),
    });
  } catch (error) {
    throw new AiError("busy", error instanceof Error ? error.message : String(error));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AiError(
      res.status >= 500 ? "busy" : "failed",
      `Upload ${res.status} ${text.slice(0, 200)}`,
    );
  }
  return target.resourceUrl;
}

/** প্রোডাক্টে নতুন media যোগ করে; নতুন media-র id ফেরত দেয় (আগের আর পরের তালিকা মিলিয়ে) */
export async function addProductMedia(
  admin: GraphqlClient,
  productId: string,
  media: Array<{ originalSource: string; type: "image" | "video"; alt: string }>,
  before: string[],
): Promise<string[]> {
  const data = await gql<{
    productUpdate: {
      product: { media: { nodes: Array<{ id: string }> } } | null;
      userErrors: UserErrors;
    } | null;
  }>(
    admin,
    `#graphql
    mutation AiAddProductMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
      productUpdate(product: $product, media: $media) {
        product { media(first: 250) { nodes { id } } }
        userErrors { field message }
      }
    }`,
    {
      product: { id: productId },
      media: media.map((item) => ({
        originalSource: item.originalSource,
        mediaContentType: item.type === "video" ? "VIDEO" : "IMAGE",
        alt: item.alt.slice(0, 512),
      })),
    },
  );
  check(data.productUpdate?.userErrors, "productUpdate");
  const known = new Set(before);
  return (data.productUpdate?.product?.media.nodes ?? [])
    .map((node) => node.id)
    .filter((id) => !known.has(id));
}

/** আমাদের যোগ করা media মোছে; আগেই মুছে থাকলে সেটা ত্রুটি নয় */
export async function deleteMedia(admin: GraphqlClient, ids: string[]) {
  if (ids.length === 0) return;
  const data = await gql<{
    fileDelete: { deletedFileIds: string[] | null; userErrors: UserErrors } | null;
  }>(
    admin,
    `#graphql
    mutation AiDeleteMedia($fileIds: [ID!]!) {
      fileDelete(fileIds: $fileIds) { deletedFileIds userErrors { field message code } }
    }`,
    { fileIds: ids },
  );
  const errors = (data.fileDelete?.userErrors ?? []).filter(
    (error) => error.code !== "FILE_DOES_NOT_EXIST" && !/not exist|not found/i.test(error.message),
  );
  check(errors, "fileDelete");
}
