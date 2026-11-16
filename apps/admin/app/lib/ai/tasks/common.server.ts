import { z } from "zod";
import db from "../../../db.server";
import { brandPrompt, HONESTY_RULES, readBrand } from "../brand";

export const productGid = z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/);
export const imageGid = z.string().regex(/^gid:\/\/shopify\/MediaImage\/\d+$/);
export const notes = z.string().trim().max(500).default("");

/** দোকানের ব্র্যান্ডের সুর আর সব প্রম্পটের সাধারণ নিয়ম যোগ করে সিস্টেম প্রম্পট বানায় */
export async function systemPrompt(shopId: string, task: string): Promise<string> {
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { aiSettings: true } });
  return [task.trim(), HONESTY_RULES, brandPrompt(readBrand(shop?.aiSettings))].join("\n\n");
}

/** মার্চেন্টের বাড়তি কথা, প্রম্পটে আলাদা করে চিহ্নিত */
export const merchantNotes = (value: string) =>
  value ? `\n\nNotes from the store owner about what they want:\n${value}` : "";
