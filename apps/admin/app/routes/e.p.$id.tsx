import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { isValidPushClick } from "../lib/links.server";

/** Push নোটিফিকেশনে ক্লিক: গুনে স্টোরের পেজে পাঠায় (ঠিকানা সই করা) */
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const target = url.searchParams.get("u") ?? "";
  const id = params.id ?? "";
  if (!isValidPushClick(id, target, url.searchParams.get("s") ?? "")) {
    return new Response("Not found", { status: 404 });
  }
  await db.pushCampaign
    .updateMany({ where: { id }, data: { clicks: { increment: 1 } } })
    .catch(() => undefined);
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "no-store" },
  });
};
