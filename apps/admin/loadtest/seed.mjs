/**
 * লোড টেস্টের জন্য নকল দোকান বানানো বা মুছে ফেলা। শুধু স্টেজিং বা লোকাল ডাটাবেসে চালান, কখনো আসলটায় নয়।
 *
 *   LOADTEST_SEED=yes node loadtest/seed.mjs --stores 1000
 *   LOADTEST_SEED=yes node loadtest/seed.mjs --clean
 *
 * প্রতিটা দোকান: loadtest-0001.myshopify.com ধরনের নাম, Professional প্ল্যান, Shopify-র নকল offline
 * session (আসল টোকেন নয়, তাই Shopify-তে কোনো কল যায় না), Reviews আর Live Chat চালু, ২০টা রিভিউ,
 * ১০টা Recent Sales, আর পিক্সেলের চাবি lt-key-0001।
 */
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const STORES = Number(option("stores", process.env.STORES ?? 1000));
const PREFIX = process.env.SHOP_PREFIX ?? "loadtest-";
const clean = args.includes("--clean");

if (process.env.LOADTEST_SEED !== "yes") {
  console.error(
    "Refusing to run: set LOADTEST_SEED=yes, and only against a staging or local database.",
  );
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run with NODE_ENV=production.");
  process.exit(1);
}
if (!Number.isInteger(STORES) || STORES < 1 || STORES > 9999) {
  console.error("--stores must be a whole number from 1 to 9999.");
  process.exit(1);
}

const db = new PrismaClient();
const pad = (i) => String(i).padStart(4, "0");
const domain = (i) => `${PREFIX}${pad(i)}.myshopify.com`;
const PRODUCTS = ["1001", "1002", "1003", "1004", "1005"];

async function removeAll() {
  const sessions = await db.session.deleteMany({
    where: { shop: { startsWith: PREFIX, endsWith: ".myshopify.com" } },
  });
  // দোকানের সব ডেটা (রিভিউ, পরিসংখ্যান, চ্যাট...) Shop-এর সাথে cascade হয়ে মোছে
  const shops = await db.shop.deleteMany({
    where: { domain: { startsWith: PREFIX, endsWith: ".myshopify.com" } },
  });
  console.log(`Removed ${shops.count} test shops and ${sessions.count} sessions.`);
}

async function seed() {
  await removeAll();
  const numbers = Array.from({ length: STORES }, (_, i) => i + 1);
  for (let start = 0; start < numbers.length; start += 200) {
    const chunk = numbers.slice(start, start + 200);
    await db.shop.createMany({
      data: chunk.map((i) => ({
        domain: domain(i),
        plan: "professional",
        ingestKey: `lt-key-${pad(i)}`,
      })),
    });
    await db.session.createMany({
      data: chunk.map((i) => ({
        id: `offline_${domain(i)}`,
        shop: domain(i),
        state: "",
        isOnline: false,
        scope: "read_products",
        accessToken: "loadtest-not-a-real-token",
      })),
    });
    const shops = await db.shop.findMany({
      where: { domain: { in: chunk.map(domain) } },
      select: { id: true },
    });
    await db.toolSetting.createMany({
      data: shops.flatMap((shop) =>
        ["product-reviews", "live-chat", "recent-sales"].map((toolId) => ({
          shopId: shop.id,
          toolId,
          enabled: true,
          settings: {},
        })),
      ),
    });
    await db.review.createMany({
      data: shops.flatMap((shop) =>
        Array.from({ length: 20 }, (_, n) => ({
          shopId: shop.id,
          productId: PRODUCTS[n % PRODUCTS.length],
          rating: 3 + (n % 3),
          title: `Review ${n + 1}`,
          body: "Good quality and fast delivery. Would buy again.",
          authorName: `Buyer ${n + 1}`,
          status: "published",
          source: "import",
        })),
      ),
    });
    await db.recentSale.createMany({
      data: shops.flatMap((shop) =>
        Array.from({ length: 10 }, (_, n) => ({
          shopId: shop.id,
          productId: PRODUCTS[n % PRODUCTS.length],
          title: `Product ${n + 1}`,
          handle: `product-${n + 1}`,
          soldAt: new Date(Date.now() - n * 3_600_000),
        })),
      ),
    });
    console.log(`Seeded ${Math.min(start + chunk.length, STORES)} of ${STORES} shops`);
  }
}

try {
  if (clean) await removeAll();
  else await seed();
} finally {
  await db.$disconnect();
}
