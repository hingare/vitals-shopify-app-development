import db from "../db.server";
import type { GraphqlClient } from "./tools.server";

/**
 * রিভিউর ছবি মার্চেন্টের Shopify Files-এ রাখা হয়:
 * ১. ক্রেতার ব্রাউজার আমাদের কাছে আপলোডের অনুমতি চায় (stagedUploadsCreate)
 * ২. ব্রাউজার সরাসরি Shopify-র স্টোরেজে ছবি পাঠায় (আমাদের সার্ভার দিয়ে বড় ফাইল যায় না)
 * ৩. রিভিউ জমা দেওয়ার সময় সেই ঠিকানা দিয়ে fileCreate করে Shopify Files-এ যোগ হয়
 */
export const MAX_MEDIA = 3;
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
export const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const STAGED_HOSTS = ["shopify-staged-uploads.storage.googleapis.com"];

export interface UploadRequest {
  name: string;
  type: string;
  size: number;
}

/** ব্রাউজার যে ফাইলের তালিকা পাঠায় তা যাচাই; ভুল থাকলে null */
export function parseUploadRequest(body: unknown): UploadRequest[] | null {
  const files = (body as { files?: unknown })?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_MEDIA) return null;
  const out: UploadRequest[] = [];
  for (const file of files) {
    const { name, type, size } = (file ?? {}) as Record<string, unknown>;
    if (typeof type !== "string" || !(MEDIA_TYPES as readonly string[]).includes(type)) {
      return null;
    }
    if (typeof size !== "number" || size <= 0 || size > MAX_MEDIA_BYTES) return null;
    const ext = type.split("/")[1];
    const safeName =
      typeof name === "string" && /^[\w.\- ]{1,100}$/.test(name) ? name : `review.${ext}`;
    out.push({ name: safeName, type, size });
  }
  return out;
}

/** রিভিউর সাথে আসা ছবির ঠিকানা শুধু Shopify-র staged স্টোরেজের হলে গ্রহণ */
export function parseMediaUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  for (const item of value.slice(0, MAX_MEDIA)) {
    if (typeof item !== "string") continue;
    try {
      const url = new URL(item);
      if (url.protocol === "https:" && STAGED_HOSTS.includes(url.hostname)) urls.push(url.href);
    } catch {
      // ভুল URL বাদ
    }
  }
  return urls;
}

export async function createUploadTargets(admin: GraphqlClient, files: UploadRequest[]) {
  const res = await admin.graphql(
    `#graphql
    mutation ReviewUploadTargets($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { message }
      }
    }`,
    {
      variables: {
        input: files.map((f) => ({
          filename: f.name,
          mimeType: f.type,
          fileSize: String(f.size),
          resource: "IMAGE",
          httpMethod: "POST",
        })),
      },
    },
  );
  const json = (await res.json()) as {
    data?: {
      stagedUploadsCreate?: {
        stagedTargets: Array<{
          url: string;
          resourceUrl: string;
          parameters: Array<{ name: string; value: string }>;
        }>;
        userErrors: Array<{ message: string }>;
      };
    };
  };
  const result = json.data?.stagedUploadsCreate;
  if (!result || result.userErrors.length > 0) {
    throw new Error(result?.userErrors.map((e) => e.message).join(", ") ?? "upload failed");
  }
  return result.stagedTargets;
}

/** আপলোড করা ছবি Shopify Files-এ যোগ করে রিভিউর সাথে জুড়ে দেয় */
export async function attachMedia(
  admin: GraphqlClient,
  reviewId: string,
  urls: string[],
  alt: string,
) {
  if (urls.length === 0) return;
  const res = await admin.graphql(
    `#graphql
    mutation ReviewFileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id ... on MediaImage { image { url } } }
        userErrors { message }
      }
    }`,
    {
      variables: {
        files: urls.map((originalSource) => ({
          originalSource,
          contentType: "IMAGE",
          alt: alt.slice(0, 120),
        })),
      },
    },
  );
  const json = (await res.json()) as {
    data?: {
      fileCreate?: {
        files: Array<{ id: string; image?: { url?: string } | null }>;
        userErrors: Array<{ message: string }>;
      };
    };
  };
  const files = json.data?.fileCreate?.files ?? [];
  if (files.length === 0) return;
  await db.reviewMedia.createMany({
    data: files.map((f) => ({ reviewId, fileId: f.id, url: f.image?.url ?? null })),
  });
}

/**
 * Shopify ছবি প্রসেস করতে কয়েক সেকেন্ড নেয়; যেসব ছবির URL এখনও নেই সেগুলো জেনে নিয়ে সেভ করে।
 * স্টোরফ্রন্ট বা অ্যাডমিন যখন রিভিউ পড়ে তখন ডাকা হয়।
 */
export async function resolvePendingMedia(
  admin: GraphqlClient,
  media: Array<{ id: string; fileId: string; url: string | null }>,
) {
  const pending = media.filter((m) => !m.url).slice(0, 50);
  if (pending.length === 0) return media;
  try {
    const res = await admin.graphql(
      `#graphql
      query ReviewMediaUrls($ids: [ID!]!) {
        nodes(ids: $ids) { id ... on MediaImage { image { url } } }
      }`,
      { variables: { ids: pending.map((m) => m.fileId) } },
    );
    const json = (await res.json()) as {
      data?: { nodes?: Array<{ id?: string; image?: { url?: string } | null } | null> };
    };
    const urls = new Map<string, string>();
    for (const node of json.data?.nodes ?? []) {
      if (node?.id && node.image?.url) urls.set(node.id, node.image.url);
    }
    await Promise.all(
      pending
        .filter((m) => urls.has(m.fileId))
        .map((m) =>
          db.reviewMedia.update({ where: { id: m.id }, data: { url: urls.get(m.fileId) } }),
        ),
    );
    return media.map((m) => (m.url ? m : { ...m, url: urls.get(m.fileId) ?? null }));
  } catch {
    return media;
  }
}

/** রিভিউ মুছলে তার ছবিও Shopify Files থেকে মুছে ফেলে */
export async function deleteMediaFiles(admin: GraphqlClient, fileIds: string[]) {
  for (let i = 0; i < fileIds.length; i += 50) {
    await admin
      .graphql(
        `#graphql
        mutation ReviewFileDelete($fileIds: [ID!]!) {
          fileDelete(fileIds: $fileIds) { userErrors { message } }
        }`,
        { variables: { fileIds: fileIds.slice(i, i + 50) } },
      )
      .catch((error) => console.warn("[reviews] file delete failed", error));
  }
}
