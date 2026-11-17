# AllInOne Shopify App (অস্থায়ী নাম)

Vitals-এর মতো অল-ইন-ওয়ান Shopify অ্যাপ: দুটি প্ল্যান (Starter, Professional), কোনো usage fee নেই।
অ্যাপের আসল নাম পরে ঠিক হবে; নাম, লোগো ও রং [`packages/brand/src/index.ts`](packages/brand/src/index.ts)-এ এক জায়গায় আছে।

- পুরো প্ল্যান ও স্টেজ: [ডেভেলপমেন্ট প্ল্যান](https://claude.ai/artifact/FhhV8ZDDrc7xLbQGaFZ1eV)
- এখনকার স্টেজ: **স্টেজ ৮, হার্ডেনিং ও প্রাইভেট বেটা**
- Built for Shopify শর্তের সাথে মেলানো: [docs/built-for-shopify.md](docs/built-for-shopify.md)
- লোড টেস্ট (১,০০০ দোকানের ব্যস্ত সময়) আর মাপা ফল: [apps/admin/loadtest/README.md](apps/admin/loadtest/README.md)
- ডাটাবেসের ব্যাকআপ, রিস্টোর আর মহড়া: [docs/backup-restore.md](docs/backup-restore.md)

## ফোল্ডার কাঠামো

```
apps/
  admin/            Shopify অ্যাপ (React Router + Polaris), ব্যাকএন্ড ও webhooks
    extensions/     theme-embed (সব টুল চালানো app embed); পরে Discount Functions, Checkout UI
    prisma/         ডাটাবেস স্কিমা (PostgreSQL)
  web/              ওয়েবসাইট (Next.js): হোম, টুল পেজ, Pricing, তুলনা, ব্লগ, হেল্প সেন্টার, AI সাপোর্ট চ্যাট
packages/
  brand/            অ্যাপের নাম, লোগো, রং
  i18n/             অ্যাডমিনের ভাষা (এখন ইংরেজি; নতুন ভাষা যোগ করার নিয়ম নিচে)
  tools/            সব টুলের তালিকা (registry) ও স্টোর কনফিগ তৈরি
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
pnpm --filter @app/admin run setup           # ডাটাবেস টেবিল তৈরি (লোকাল পোর্ট: PostgreSQL 5434, Redis 6380)
pnpm dev                                     # Shopify-তে লগইন করে অ্যাপ বানাবে ও dev store-এ চালাবে
```

প্রথমবার `pnpm dev` চালালে Shopify CLI জিজ্ঞেস করবে নতুন অ্যাপ বানাবে কিনা: **Yes, create a new app** বেছে নিন।

## দৈনন্দিন কমান্ড

| কমান্ড                        | কী করে                                                      |
| ----------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                    | অ্যাপ লোকালি চালায়                                         |
| `pnpm dev:web`                | ওয়েবসাইট লোকালি চালায় (<http://localhost:3100>)           |
| `pnpm typecheck`              | সব প্যাকেজে টাইপ চেক                                        |
| `pnpm test`                   | টেস্ট ও উইজেটের সাইজ বাজেট (লোডার ৫KB, প্রতি টুল ১০KB gzip) |
| `pnpm build`                  | প্রোডাকশন বিল্ড                                             |
| `pnpm db:up` / `pnpm db:down` | লোকাল ডাটাবেস চালু / বন্ধ                                   |

## নতুন ভাষা যোগ করা

1. অ্যাডমিন: `packages/i18n/src/locales/en.ts` কপি করে `<code>.ts` বানান (যেমন `bn.ts`), অনুবাদ করুন, তারপর `packages/i18n/src/index.ts`-এর `dictionaries`-এ এক লাইন যোগ করুন।
2. স্টোরের উইজেট: `packages/widgets/src/i18n.ts`-এ নতুন ভাষার একটা ব্লক যোগ করুন।
3. ওয়েবসাইট: `apps/web/src/i18n/routing.ts`-এর `locales`-এ কোড যোগ করুন, আর `apps/web/messages/en.json` কপি করে `<code>.json` বানিয়ে অনুবাদ করুন। হেল্প আর্টিকেল, ব্লগ, তুলনা ও আইনি পেজ অনুবাদ না হওয়া পর্যন্ত ইংরেজিতে দেখায়, আর সেগুলোর canonical ইংরেজি পেজে থাকে।

কোনো লেখা অনুবাদ না করলে সেখানে ইংরেজি দেখাবে। Shopify-র ভাষা মিললে অ্যাপ নিজেই সেই ভাষা দেখায়।

## নতুন টুল যোগ করা

1. `packages/tools/src/<tool-id>.ts`-এ `defineTool` দিয়ে টুল ও সেটিংস লিখুন, `packages/tools/src/index.ts`-এর registry-তে যোগ করুন।
2. `packages/widgets/src/tools/<tool-id>.tsx`-এ উইজেট লিখুন (`mount` ফাংশন এক্সপোর্ট করুন)।
3. `apps/admin/app/components/previews/`-এ প্রিভিউ যোগ করুন, আর `en.ts`-এ টুলের নাম ও ফিল্ডের লেখা দিন।

সেটিংস ফর্ম স্কিমা দেখে নিজেই তৈরি হয়; আলাদা ফর্ম লিখতে হয় না।

## ওয়েবসাইট (apps/web)

```bash
copy apps\web\.env.example apps\web\.env.local   # (Mac/Linux: cp) সব মান ফাঁকা রাখলেও চলে
pnpm dev:web
```

- টুলের নাম, প্ল্যান, দাম ও টুলের সংখ্যা অ্যাপের একই জায়গা থেকে আসে (`packages/tools`, `packages/i18n`, `packages/tool-sdk`), তাই অ্যাপে কিছু বদলালে সাইটও নিজে থেকে বদলায়।
- লেখাগুলো `apps/web/src/content`-এ: `help/` (প্রতিটি টুলের আর্টিকেল ও গাইড), `blog/`, `compare/`, `legal/` (Privacy ও Terms)। লেখায় দাম বা নাম সরাসরি না লিখে `{brand}`, `{proPrice}`, `{trialDays}`-এর মতো জায়গা রাখুন; টেস্ট এটা যাচাই করে।
- নতুন টুল যোগ করলে `help/en/tools/`-এ তার আর্টিকেলও লিখতে হবে, না হলে টেস্ট ফেল করবে।
- Privacy ও Terms এখন খসড়া: কোম্পানির ঠিকানা, আইনের দেশ ও হোস্টিং ঠিক করে আইনজীবী দেখার পর `packages/brand`-এ `legal.reviewed: true` দিন, তখন খসড়ার নোটিশ সরে যাবে।
- সাইটের ঠিকানা, PostHog, Search Console/Bing ভেরিফিকেশন আর সাপোর্ট চ্যাটের চাবি `.env.example`-এ লেখা আছে। এগুলো বিল্ডের সময় লাগে।
- `/llms.txt` ও `/llms-full.txt` AI সহকারীদের জন্য পুরো সাইটের লেখা দেয়; `robots.txt` AI crawler-দের অনুমতি দেয়।

## নিয়ম

- প্রতিটি নতুন টুল `defineTool` দিয়ে ঘোষণা করতে হবে এবং প্ল্যানের "সম্পূর্ণ" চেকলিস্ট পাস করতে হবে।
- উইজেটের সাইজ বাজেট পার হলে CI ফেল করবে।
- `.env` বা কোনো পাসওয়ার্ড/API key কখনো GitHub-এ দেবেন না।
