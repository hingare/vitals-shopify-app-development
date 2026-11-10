import { randomInt } from "node:crypto";
import { spinWheel } from "@app/tools";
import db from "../db.server";
import { gql } from "./admin-client.server";
import { queueEvent } from "./integrations.server";
import { subscribe } from "./subscribers.server";
import { cleanEmail, enabledSettings, type ShopRef } from "./tool-state.server";
import type { GraphqlClient } from "./tools.server";

/**
 * Spin the Wheel। ফল সার্ভারে ঠিক হয়, ব্রাউজারে নয়: প্রতিটা ঘর জেতার সম্ভাবনা ঠিক সেটিংসের
 * "chance" অনুযায়ী (চাকায় ঘরের মাপও তাই), তাই ক্রেতা যা দেখেন সেটাই আসল সুযোগ।
 * জিতলে শুধু সেই ক্রেতার জন্য একটা Shopify ডিসকাউন্ট কোড তৈরি হয়: একবার ব্যবহারযোগ্য, সত্যিকারের মেয়াদসহ।
 */
type ShopRow = ShopRef & { domain: string };

export interface NumberedSlice {
  /** সেটিংসের ঘর নম্বর (১ থেকে ৬) */
  n: number;
  prize: string;
  percentOff: number;
  chance: number;
}

/** সেটিংসের যে ঘরগুলো চাকায় থাকে (সম্ভাবনা ০ বা লেখা ফাঁকা হলে বাদ) */
export function activeSlices(settings: Record<string, unknown>): NumberedSlice[] {
  const out: NumberedSlice[] = [];
  for (let n = 1; n <= 6; n++) {
    const s = settings[`slice${n}`] as Omit<NumberedSlice, "n"> | undefined;
    if (s && s.chance > 0 && s.prize) out.push({ n, ...s });
  }
  return out;
}

/** `roll` হলো ০ থেকে (মোট সম্ভাবনা − ১); প্রতিটা ঘর তার chance-এর সমান সংখ্যক মান পায় */
export function pickSlice(slices: NumberedSlice[], roll: number): NumberedSlice {
  let upTo = 0;
  for (const slice of slices) {
    upTo += slice.chance;
    if (roll < upTo) return slice;
  }
  return slices[slices.length - 1]!;
}

// গুলিয়ে ফেলার মতো অক্ষর (0/O, 1/I/L) বাদ
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function makeCode(length = 8): string {
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `SPIN-${code}`;
}

async function createDiscount(
  admin: GraphqlClient,
  input: { code: string; percentOff: number; startsAt: Date; endsAt: Date },
): Promise<boolean> {
  const data = await gql<{
    discountCodeBasicCreate: {
      codeDiscountNode: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
    mutation SpinCode($discount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $discount) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }`,
    {
      discount: {
        title: `Spin the Wheel ${input.code}`,
        code: input.code,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        usageLimit: 1,
        appliesOncePerCustomer: true,
        context: { all: "ALL" },
        customerGets: {
          value: { percentage: input.percentOff / 100 },
          items: { all: true },
        },
      },
    },
  );
  const result = data.discountCodeBasicCreate;
  if (result.userErrors.length > 0 || !result.codeDiscountNode) {
    console.warn("[spin-wheel] discount not created", result.userErrors);
    return false;
  }
  return true;
}

export type SpinResult =
  | { ok: true; slice: number; prize: string; code: string | null; expiresAt: string | null }
  | { ok: false; error: "disabled" | "invalid" | "already" | "unavailable" };

export interface SpinDeps {
  /** ০ থেকে total − ১ পর্যন্ত সমান সম্ভাবনার একটা সংখ্যা */
  roll: (total: number) => number;
  code: () => string;
}

const defaultDeps: SpinDeps = { roll: (total) => randomInt(total), code: () => makeCode() };

export async function spin(
  shop: ShopRow,
  admin: GraphqlClient | undefined,
  rawEmail: unknown,
  deps: SpinDeps = defaultDeps,
  now = new Date(),
): Promise<SpinResult> {
  const settings = await enabledSettings(shop, spinWheel);
  if (!settings) return { ok: false, error: "disabled" };
  const email = cleanEmail(rawEmail);
  if (!email) return { ok: false, error: "invalid" };
  const slices = activeSlices(settings);
  if (slices.length === 0) return { ok: false, error: "unavailable" };

  // একজন (একটা ইমেইল) নির্দিষ্ট দিনের মধ্যে একবারই ঘোরাতে পারেন
  const since = new Date(now.getTime() - settings.frequencyDays * 86_400_000);
  const earlier = await db.wheelSpin.findFirst({
    where: { shopId: shop.id, email, createdAt: { gt: since } },
  });
  if (earlier) return { ok: false, error: "already" };

  const total = slices.reduce((sum, s) => sum + s.chance, 0);
  const won = pickSlice(slices, deps.roll(total));
  let code: string | null = null;
  let expiresAt: Date | null = null;
  if (won.percentOff > 0) {
    if (!admin) return { ok: false, error: "unavailable" };
    code = deps.code();
    expiresAt = new Date(now.getTime() + settings.codeValidDays * 86_400_000);
    const created = await createDiscount(admin, {
      code,
      percentOff: won.percentOff,
      startsAt: now,
      endsAt: expiresAt,
    }).catch((error: unknown) => {
      console.warn("[spin-wheel] discount request failed", error);
      return false;
    });
    // কোড তৈরি না হলে ঘোরানোটা গোনা হয় না: ক্রেতা আবার চেষ্টা করতে পারেন
    if (!created) return { ok: false, error: "unavailable" };
  }

  await db.wheelSpin.create({
    data: {
      shopId: shop.id,
      email,
      slice: won.n,
      label: won.prize,
      code,
      expiresAt,
      createdAt: now,
    },
  });
  // ফর্মে সম্মতির লেখা দেখিয়েই ইমেইল নেওয়া হয়
  await subscribe(shop, { email, source: "spin-wheel" });
  if (code) {
    await queueEvent(shop.id, "spin-wheel", {
      email,
      name: "Spin won",
      properties: { prize: won.prize, code, percentOff: won.percentOff },
    });
  }
  return {
    ok: true,
    slice: won.n,
    prize: won.prize,
    code,
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

export async function wheelStats(shopId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [spins, wins] = await Promise.all([
    db.wheelSpin.count({ where: { shopId, createdAt: { gte: since } } }),
    db.wheelSpin.count({ where: { shopId, createdAt: { gte: since }, code: { not: null } } }),
  ]);
  return { spins, wins };
}
