# থিম এক্সটেনশন (`apps/admin/extensions/theme-embed`)

দোকানের থিমে আমাদের যা যায় তার সব এই এক্সটেনশনে: একটা app embed (সব টুল চালায়), কয়েকটা app block, থিম
সেকশন, snippet, আর `packages/widgets` থেকে বিল্ড করা JavaScript (`assets`, git-এ থাকে না)।

## Liquid-এর ১০০KB সীমা

Shopify একটা theme app extension-এর সব Liquid (`blocks` আর `snippets`) মিলিয়ে ১০০KB-র বেশি হলে deploy নেয়
না ("Size of Liquid across all files", enforced)। মন্তব্যও গোনা হয়, আর বাংলা অক্ষর UTF-8-এ ৩ বাইট নেয়। তাই:

- Liquid ফাইলে মন্তব্য না রাখা, দরকার হলে এক লাইনের ইংরেজি। ব্যাখ্যা এই ফাইলে লিখুন।
- `apps/admin/app/lib/theme-extension.test.ts` সব Liquid মিলিয়ে মাপে আর ১,০০,০০০ বাইট পেরোলে ব্যর্থ হয়
  (Shopify KB বলতে ১০০০ না ১০২৪ বাইট বোঝায় তা লেখেনি, তাই ছোটটা)। ৩০ ব্লক আর ব্লকের নাম ২৫ অক্ষরের সীমাও
  সেখানে দেখা হয়।
- সবচেয়ে বড় ফাইল `snippets/app-early.liquid` (পাতা আঁকার আগে চলা স্ক্রিপ্ট, প্রায় ২৭KB)। `src/early.ts` বা
  `src/early/`-এ কিছু যোগ করলে এটাও বাড়ে, তাই আগে মাপ দেখুন:
  `find apps/admin/extensions/theme-embed -name "*.liquid" -printf "%s\n" | awk '{s+=$1}END{print s}'`।
  ২০২৬-১১-এ মোট প্রায় ৯৬,৫০০ বাইট।

## app embed: `blocks/app-tools-embed.liquid`

একটি মাত্র app embed সব টুল চালায়। চালু টুলের কনফিগ app-owned metafield (`app_config.tools`) থেকে আসে, তাই
কোনো API কল লাগে না। লোডার ৫KB-র কম, আর শুধু চালু টুলগুলোর ফাইল আলাদাভাবে আনে।

embed পাতার `<head>`-এ বসে (`target: head`), যাতে `app-early` স্নিপেট থিমের HTML পড়ার সময়েই পাতার ভেতরের
উইজেটের জায়গা নিতে পারে; তাতে পাতা আঁকার পরে লেখা নিচে সরে না (CLS)। কীভাবে, তা
[storefront-tests.md](storefront-tests.md#পাতা-সরে-না-আগেভাগে-বসা-উইজেট)-এ।

ভেতরে, ওপর থেকে:

- **`early`**: চালু টুলের মধ্যে অন্তত একটা `src/early.ts` আগেই আঁকে এমন হলে তবেই `app-early` বসে। `when`
  তালিকাটা early.ts-এর টুলগুলোর সাথে মিলিয়ে রাখুন; `e2e/tools.e2e.ts` এই তালিকা পড়েই প্রতিটার "পাতা আসতে থাকা
  অবস্থায়" পরীক্ষা চালায়।
- **Best Sellers Protection** (`<script id="app-bsp">`), নিচে আলাদা করে।
- **`window.__APP_CONFIG__`**: লোডার আর টুলের যা লাগে (পাতার ধরন, ভাষা, মুদ্রা, কার্ট, চালু টুল আর সেটিংস,
  অফার)। `countries` শুধু Geolocation redirect চালু থাকলে ভরা হয়।
- **প্রোডাক্ট পাতা**:
  - `app-product-json`: প্রোডাক্ট, বেছে নেওয়া ভ্যারিয়েন্ট আর স্টক (`inventory`, শুধু Shopify যে ভ্যারিয়েন্টের স্টক
    গোনে আর শেষ হলে বিক্রি বন্ধ করে)। `preorder`: স্টক শেষ কিন্তু "স্টক না থাকলেও বিক্রি" চালু এমন ভ্যারিয়েন্ট
    (Pre-Orders)।
  - `<template id="app-ai-faq">`: থিমে "AI FAQ" ব্লক না থাকলে `tool-ai-product-faq.js` এখান থেকে নিয়ে প্রোডাক্ট
    সেকশনের পরে বসায়।
  - রেটিংয়ের JSON-LD: রিভিউ চালু থাকলে Google-এর জন্য রেটিং (Shopify-র `reviews.*` metafield থেকে)। AI SEO
    Schema-র পুরো Product schema চালু থাকলে রেটিং সেখানেই থাকে, তাই এখানে আলাদা করে দেওয়া হয় না (একই প্রোডাক্ট
    দুবার নয়)।
- **`<template id="app-payment-icons">`**: Payment logos-এর লোগো Shopify নিজেই দেয়, স্টোরে চালু পেমেন্টগুলোর।
- **দ্রুত চেকআউট বাটন লুকানো** (Hide dynamic checkout): `<style>` পাতা আঁকার আগেই, যাতে বাটন এক মুহূর্তের
  জন্যও না দেখায়।
- **`ai-seo-schema`** snippet, নিচে।
- **`app-early`**: পাতার ভেতরে বসা উইজেট (উপরের বার, Add to cart-এর নিচের বাক্স, কার্টের নোটিস, বিবরণের ট্যাব,
  প্রি-অর্ডারের বাটনের লেখা) থিমের HTML পড়ার সময়েই বসায়, পাতা আঁকার আগে।
- শেষে লোডার (`loader.js`, `defer`)।

### Best Sellers Protection

কেউ `?sort_by=best-selling` লিংকে এলে সাধারণ ক্রমে পাঠানো হয়। স্ক্রিপ্টটা embed-এ (লোডারের আগে) থাকে যাতে
তালিকাটা যত কম সময় সম্ভব চোখে পড়ে; থিম পেজ নতুন করে লোড না করে ক্রম বদলালে উইজেট এই একই ফাংশন
(`window.__APP_BSP__`) ডাকে। মার্চেন্ট নিজে কালেকশনের মূল ক্রম best-selling রাখলে কিছু করা হয় না।

অনন্ত ঘোরাঘুরি ঠেকানো: কিছু থিমে এমন কোড থাকে যা সাধারণ পেজ খুললেই best-selling-এ পাঠায়; সেখানে আমরা
ফেরত পাঠালে পেজ থামত না। তাই `sessionStorage`-এ (`app-bsp`) মনে রাখা হয় শেষ কখন পাঠানো হলো আর এই ট্যাবে মোট
কতবার। পাঠানোর ৩০ সেকেন্ডের মধ্যে একই পেজের সাধারণ ঠিকানা থেকে (`document.referrer`) আবার best-selling-এ
আসা হলে সেটা থিমের কাজ ধরে নেওয়া হয়; তখন, বা এই ট্যাবে ৩ বার পাঠানো হয়ে গেলে, মান `off` হয় আর এই ট্যাবে আর
পাঠানো হয় না। `sessionStorage` বন্ধ থাকলে পাঠানোই হয় না। নতুন পেজ আসা পর্যন্ত তালিকা আড়ালে থাকে; ৫
সেকেন্ডেও না এলে পেজ আবার দেখা যায়। স্ক্রিপ্টের ভেতরে মন্তব্য নেই, কারণ সেগুলো ক্রেতার ব্রাউজারে যেত।

## snippets

- **`app-early.liquid`**: `packages/widgets/src/early.ts` থেকে বানানো (`scripts/build-early.mjs`), git-এ থাকে।
  হাতে বদলাবেন না: early.ts বা `src/early/` বদলে `pnpm --filter @app/widgets build` চালান আর স্নিপেটসহ commit
  করুন। `pnpm test` মিলিয়ে দেখে।
- **`ai-seo-schema.liquid`**: AI SEO Schema, Google আর AI সার্চের জন্য JSON-LD, সার্ভারেই লেখা (JS ছাড়া
  ক্রলাররাও পড়ে)। প্রতিটা মান `json` ফিল্টার দিয়ে যায়, তাই দোকানের লেখায় `"` বা `</script>` থাকলেও JSON ভাঙে না,
  স্ক্রিপ্টও ঢোকে না। `data-app-schema` চিহ্ন দিয়ে আমাদের schema চেনা যায় (থিমের একই schema সরানোর সময় এগুলো
  থাকে)। প্যারামিটার: `s` = টুলের সেটিংস, `reviews_on` = রিভিউ টুল চালু কিনা, `product`, `collection`।
- **`ai-faq.liquid`**: AI Product FAQ, প্রোডাক্টের প্রশ্ন-উত্তর (মার্চেন্ট AI Studio-তে দেখে বসিয়েছেন)। সার্ভারেই
  লেখা, তাই ক্রলাররাও পড়ে; সব লেখা escape করা। `faqSchema` চালু থাকলে Google আর AI সার্চের জন্য FAQPage
  schema। প্যারামিটার: `faq` = `product.metafields["$app"].ai_faq.value`, `s` = টুলের সেটিংস।
- **`ats-icon.liquid`**: থিম সেকশনের ছোট আইকন। `icon`: truck, shield, return, star, heart, leaf, clock, chat, gift,
  lock (বা none)।

## app block

- **`app-widget.liquid`** ("Widget"): একটাই ব্লক দিয়ে যেকোনো উইজেট থিমের যেকোনো জায়গায় বসানো যায় (Shopify-র ৩০
  ব্লকের সীমা বাঁচাতে)। মার্চেন্ট "Widget" থেকে বাছেন; সেই টুল চালু থাকলে উইজেট এখানেই বসে, না হলে কিছুই দেখায়
  না।
- **`ai-faq.liquid`**: AI FAQ কোথায় বসবে তা মার্চেন্ট থিম এডিটরে ঠিক করেন। টুল চালু না থাকলে কিছু দেখায় না। এই
  ব্লক না থাকলে app embed প্রোডাক্ট সেকশনের পরে বসায় (`tool-ai-product-faq.js`)।
- **`product-reviews.liquid`**: রিভিউ তালিকা কোথায় বসবে তা মার্চেন্ট থিম এডিটরে ঠিক করেন। আসল তালিকা app
  embed-এর রিভিউ টুল এখানে বসিয়ে দেয়; এই ব্লক না থাকলে প্রোডাক্ট সেকশনের পরে বসে।
- **`store-reviews.liquid`**: স্টোর রিভিউ (কোনো নির্দিষ্ট প্রোডাক্টের নয়)। হোম পেজ বা আলাদা "Reviews" পেজে বসানো
  যায়। তালিকা আর ফর্ম app embed-এর রিভিউ টুল এখানে বসিয়ে দেয়।
- **`star-rating.liquid`**: প্রোডাক্টের নামের নিচে স্টার রেটিং। কোনো JavaScript নেই, সরাসরি `reviews.*` metafield
  থেকে আসে। ক্লিক করলে পেজের রিভিউ অংশে যায়।

## থিম সেকশন (`blocks/section-*.liquid`)

শুধু Liquid আর CSS (`sections.css`, `packages/widgets/public` থেকে বিল্ডে কপি হয়), কোনো JavaScript নেই, তাই
দোকান দ্রুত থাকে। একমাত্র ব্যতিক্রম Newsletter signup: কয়েক লাইনের JavaScript, যা জমা দেওয়া ইমেইল Shopify-র
Visitor API-কে জানায় (ভিজিটর অ্যানালিটিক্সে সম্মতি না দিলে কিছু পাঠায় না)। প্রতিটা সেকশনের নাম তার `{% schema %}`-এ।
