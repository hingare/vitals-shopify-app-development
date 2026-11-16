import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { loadProduct, smallImage } from "../lib/ai/product.server";
import { productGid } from "../lib/ai/tasks/common.server";

/** ছবি ও ভিডিওর AI টুলের ফর্মে বাছা প্রোডাক্টের ছবিগুলো (ছোট মাপে, মাপসহ) */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const id = new URL(request.url).searchParams.get("product") ?? "";
  if (!productGid.safeParse(id).success) return { product: id, images: [] };
  const product = await loadProduct(admin, id).catch(() => null);
  return {
    product: id,
    images: (product?.images ?? []).map((image, index) => ({
      id: image.id,
      position: index + 1,
      url: smallImage(image.url, 240),
      width: image.width,
      height: image.height,
    })),
  };
};

export type ProductImagesData = Awaited<ReturnType<typeof loader>>;
