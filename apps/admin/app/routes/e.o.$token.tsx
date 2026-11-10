import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { readOpenToken } from "../lib/links.server";

/** ইমেইলের ভেতরের ১x১ ছবি: খোলা হলে একবার চিহ্ন পড়ে। সই না মিললেও ছবিই ফেরত যায় (কিছু ফাঁস হয় না) */
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const id = readOpenToken(params.token ?? "");
  if (id) {
    await db.message
      .updateMany({ where: { id, openedAt: null }, data: { openedAt: new Date() } })
      .catch(() => undefined);
  }
  return new Response(GIF, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, max-age=0",
      "Content-Length": String(GIF.length),
    },
  });
};
