# দোকানের উইজেটের পরীক্ষা (Playwright)

`packages/widgets/e2e` একটা নকল Shopify দোকান বানায় (Dawn-এর মতো পাতা, Shopify-র Ajax API আর আমাদের App
Proxy-র নকল উত্তর) আর আসল বিল্ড করা উইজেট (`theme-embed/assets`) চালায়। ইন্টারনেট বা কোনো দোকান লাগে না।
প্রতি PR-এ CI-র `storefront` ধাপে ডেস্কটপ (1280×800) আর ফোনে (Pixel 7) চলে।

## কী দেখে

- **প্রতিটা টুল একা চালু করে** (`tools.e2e.ts`): টুলটা আসলেই দেখা যায়, axe-core-এ (WCAG 2.2 AA আর ভালো অভ্যাস)
  serious বা critical সমস্যা নেই, জাভাস্ক্রিপ্ট ভুল নেই, আর পাতা ০.০১-এর বেশি সরে না (CLS)। moderate আর minor
  সমস্যা ব্যর্থ করে না, রিপোর্টে থাকে। টুল চালুর আগের নকল পাতাটা নিজে পুরো পরিষ্কার, তাই যা ধরা পড়ে তা টুলেরই।
- **কীবোর্ড** (`keyboard.e2e.ts`): পপ-আপ, স্পিন হুইল, সাইজ চার্ট, উইশলিস্ট, কার্ট ড্রয়ার, সার্চ, চ্যাট, কুইক লিংক আর
  আপসেল খুললে ফোকাস ভেতরে যায়, Tab পেছনের পাতায় যায় না, Escape বন্ধ করে আর ফোকাস আগের জায়গায় ফেরে; খোলা
  অবস্থায়ও axe চলে। ট্যাব, Agree to terms, Back in stock আর রিভিউ ফর্ম কীবোর্ডে পুরো চলে কিনা।

## চালানো

```sh
pnpm --filter @app/widgets build
pnpm --filter @app/widgets e2e              # সব
pnpm --filter @app/widgets e2e -g popup     # নামে "popup" আছে এমন পরীক্ষা
```

প্রথমবার নিজের PC-তে: `pnpm --filter @app/widgets exec playwright install chromium`। ব্যর্থ হলে
`packages/widgets/test-results`-এ পাতার স্ক্রিনশট আর অবস্থা থাকে (CI-তে artifact হিসেবে)।

## নতুন টুল যোগ করলে

`e2e/scenarios.ts`-এ টুলের ঘর লাগবে: কোন পাতায়, কোন সেটিংসে দেখা যায়, আর দেখা গেলে কোন উপাদান থাকে। না দিলে
"every storefront tool has a scenario" পরীক্ষা ব্যর্থ হয়। ভুল সেটিংস দিলে (যা টুল মানে না) পরীক্ষা সাথে সাথে বলে।

## এখনো বাকি: পাতা সরে যাওয়া

৯টা টুল পাতা আঁকার পরে পাতার মাঝে নতুন কিছু বসায়, তাই ডেস্কটপে নিচের লেখা সরে যায়: Announcement bar আর
Spending goal (উপরে), Volume discounts, Bundles, Upsells, Countdown timer (Add to cart-এর নিচে), Cart notice আর
Agree to terms (কার্ট পেজে), Description tabs। সমাধান হলো app embed-এ পাতা আঁকার আগেই তাদের জায়গা রাখা।
ততদিন `tools.e2e.ts`-এর `KNOWN_SHIFT`-এ আজকের মাপ আছে, যাতে আর খারাপ না হয়; ঠিক হলে সেখান থেকে মুছতে হবে।
