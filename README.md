# AllInOne Shopify App (অস্থায়ী নাম)

Vitals-এর মতো অল-ইন-ওয়ান Shopify অ্যাপ: দুটি প্ল্যান (Starter, Professional), কোনো usage fee নেই।
অ্যাপের আসল নাম পরে ঠিক হবে; নাম, লোগো ও রং [`packages/brand/src/index.ts`](packages/brand/src/index.ts)-এ এক জায়গায় আছে।

- পুরো প্ল্যান ও স্টেজ: [ডেভেলপমেন্ট প্ল্যান](https://claude.ai/artifact/FhhV8ZDDrc7xLbQGaFZ1eV)
- এখনকার স্টেজ: **স্টেজ ০, প্রস্তুতি ও ফাউন্ডেশন**

## ফোল্ডার কাঠামো

```
apps/
  admin/            Shopify অ্যাপ (React Router + Polaris), ব্যাকএন্ড ও webhooks
    extensions/     Theme App Extension, Discount Functions (Rust), Checkout UI (পরের স্টেজে)
    prisma/         ডাটাবেস স্কিমা (PostgreSQL)
packages/
  brand/            অ্যাপের নাম, লোগো, রং
  tool-sdk/         defineTool: প্রতিটি টুলের নিয়ম, প্ল্যান ও সেটিংস
  widgets/          স্টোরফ্রন্ট লোডার ও টুল উইজেট (Preact, প্রতি টুল আলাদা ফাইল)
docker-compose.yml  লোকাল PostgreSQL ও Redis
```

## প্রথমবার সেটআপ (Windows)

১. এগুলো ইনস্টল করুন:

- [Node.js 22 LTS](https://nodejs.org/)
- pnpm: `corepack enable` (তারপর `pnpm -v` দিয়ে যাচাই)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Git](https://git-scm.com/)
- Shopify CLI: `npm install -g @shopify/cli`

২. Shopify Partner অ্যাকাউন্ট খুলুন এবং একটি development store বানান: <https://partners.shopify.com>

৩. এই ফোল্ডারে টার্মিনাল খুলে চালান:

```bash
pnpm install
pnpm db:up                                   # PostgreSQL ও Redis চালু
copy apps\admin\.env.example apps\admin\.env  # (Mac/Linux: cp)
pnpm --filter @app/admin setup               # ডাটাবেস টেবিল তৈরি
pnpm dev                                     # Shopify-তে লগইন করে অ্যাপ বানাবে ও dev store-এ চালাবে
```

প্রথমবার `pnpm dev` চালালে Shopify CLI জিজ্ঞেস করবে নতুন অ্যাপ বানাবে কিনা: **Yes, create a new app** বেছে নিন।

## দৈনন্দিন কমান্ড

| কমান্ড                        | কী করে                                                      |
| ----------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                    | অ্যাপ লোকালি চালায়                                         |
| `pnpm typecheck`              | সব প্যাকেজে টাইপ চেক                                        |
| `pnpm test`                   | টেস্ট ও উইজেটের সাইজ বাজেট (লোডার ৫KB, প্রতি টুল ১০KB gzip) |
| `pnpm build`                  | প্রোডাকশন বিল্ড                                             |
| `pnpm db:up` / `pnpm db:down` | লোকাল ডাটাবেস চালু / বন্ধ                                   |

## নিয়ম

- প্রতিটি নতুন টুল `defineTool` দিয়ে ঘোষণা করতে হবে এবং প্ল্যানের "সম্পূর্ণ" চেকলিস্ট পাস করতে হবে।
- উইজেটের সাইজ বাজেট পার হলে CI ফেল করবে।
- `.env` বা কোনো পাসওয়ার্ড/API key কখনো GitHub-এ দেবেন না।
