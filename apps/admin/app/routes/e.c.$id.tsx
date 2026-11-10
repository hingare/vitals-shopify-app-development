import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { isValidClick } from "../lib/links.server";

/**
 * ইমেইলের লিংকে ক্লিক: গুনে আসল ঠিকানায় পাঠায়।
 * ঠিকানাটা আমাদের সই করা, তাই এই রাস্তা দিয়ে কাউকে ইচ্ছামতো ওয়েবসাইটে পাঠানো যায় না।
 */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const target = url.searchParams.get("u") ?? "";
  const id = params.id ?? "";
  if (!isValidClick(id, target, url.searchParams.get("s") ?? "")) {
    return new Response("Not found", { status: 404 });
  }
  const now = new Date();
  await db.message
    .updateMany({ where: { id, clickedAt: null }, data: { clickedAt: now } })
    .catch(() => undefined);
  // ছবি বন্ধ রাখা ইমেইল ক্লায়েন্টে খোলা গোনা যায় না; ক্লিক মানেই খোলা হয়েছে
  await db.message
    .updateMany({ where: { id, openedAt: null }, data: { openedAt: now } })
    .catch(() => undefined);
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
};
