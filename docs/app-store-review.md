# App Store রিভিউ: শর্ত আর আমাদের অবস্থা

Shopify-র [App Store শর্তগুলো](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)
অ্যাপের সাথে মেলানোর তালিকা (স্টেজ ৯, ২০২৬-১১-২৮)। ✅ মানে কোডে আছে, ⏳ মানে মালিকের বা হোস্টিংয়ের কাজ,
— মানে এই অ্যাপে খাটে না। Built for Shopify-র বাড়তি শর্ত: [built-for-shopify.md](built-for-shopify.md)।
ক্রেতার তথ্যের আবেদন: [protected-customer-data.md](protected-customer-data.md)।

২০২৬-১১-১০ থেকে রিভিউয়ে বাতিল হলে আবার জমা দিতে অপেক্ষা করতে হয়, আর প্রতিবার অপেক্ষা লম্বা হয়। তাই
নিচের সব ⏳ শেষ করে, তারপর একবারে জমা দেওয়া ভালো।

## জমা দেওয়ার আগে মালিকের কাজ

১. **পরিচয় যাচাই** (identity verification): নতুন অ্যাপ জমা দিতে এখন বাধ্যতামূলক, Partner account থেকে।

২. **জরুরি যোগাযোগ** (৪.৫.৬): Partner account-এ ইমেইল আর ফোন নম্বর।

৩. **আসল অ্যাপ আর নাম** (৪.১.১, ৪.১.২): চূড়ান্ত নাম `packages/brand/src/index.ts`-এ, আর Dev Dashboard-এর অ্যাপের নাম
(TOML-এর `name`) লিস্টিংয়ের নামের সাথে মিলতে হবে। এখনকার "AllInOne Dev" ডেভেলপমেন্টের জন্যই থাকুক; জমা দেওয়ার
অ্যাপের জন্য আলাদা TOML (`shopify app config link`)। অ্যাপের ঠিকানা (ডোমেইন) আর API contact ইমেইলে
"Shopify" বা "Example" শব্দ থাকা চলবে না; `brand.website` এখনো example.com।

৪. **হোস্টিং** (৩.১.১): বৈধ TLS সার্টিফিকেটসহ চালু সার্ভার, তারপর `pnpm deploy`। ইমেইল (SES বা Resend), AI
(`ANTHROPIC_API_KEY`, `FAL_KEY`) আর বাকি সব চাবি দেওয়া থাকতে হবে, কারণ লিস্টিংয়ে লেখা প্রতিটা ফিচার রিভিউয়ারের কাছে
কাজ করতে হবে (২.১)। `BILLING_TEST` production-এ দেবেন না: দিলে সব দোকানের বিল টেস্ট বিল হয়ে যায়, কেউ টাকা দেয় না।

৫. **ক্রেতার তথ্যের আবেদন**: রিভিউ চলার সময় আবেদন করা যায় না, তাই আগে।
[protected-customer-data.md](protected-customer-data.md) দেখে পূরণ করুন।

৬. **Post-purchase-এর অনুমতি** (৫.৮.১): Dev Dashboard → Apps → অ্যাপ → Settings → Access requests →
Post-purchase extensions → Request access। Shopify দেখতে ৭ দিন পর্যন্ত নেয়; অনুমতির সাথেই
`write_checkout_extensions_apis` দেয়। অনুমতি ছাড়া পেমেন্টের পরের অফার আসল দোকানে চলে না।

৭. **লিস্টিং**: নিচে "লিস্টিং" অংশের শর্ত মেনে লেখা, আইকন ১২০০×১২০০ PNG বা JPEG, স্ক্রিনশট, Privacy Policy-র লিংক।

৮. **ডেমো ভিডিও** (৪.৫.৩): ইংরেজিতে বা ইংরেজি সাবটাইটেলে, ইনস্টল থেকে শুরু করে লিস্টিংয়ের প্রতিটা ফিচার চালু করে দেখানো।

৯. **রিভিউয়ারের জন্য নির্দেশনা** (৪.৫.৪, ৪.৫.৫): নিচের ইংরেজি খসড়া। Klaviyo, Mailchimp বা Omnisend লিস্টিংয়ে
লিখলে তাদের টেস্ট অ্যাকাউন্টের চাবিও দিতে হবে, এমন অ্যাকাউন্ট যাতে 2FA বা ইমেইল কোড লাগে না।

১০. **শেষ পরীক্ষা**: Partner Dashboard-এর App Store review পাতার automated checks, আর Shopify AI toolkit-এর
AI self-review চালানো। একসাথে একটাই নতুন অ্যাপ রিভিউয়ে থাকতে পারে।

## শর্ত অনুযায়ী অবস্থা

### ১. নীতি আর বিল

| শর্ত                                                              | অবস্থা | কোথায় বা কেন                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ১.১.১ session token, third-party cookie বা localStorage ছাড়া চলা | ✅     | App Bridge আর session token (`shopify-app-react-router`); অ্যাডমিনের কোডে ব্রাউজারের storage নেই                                                                                                                          |
| ১.১.২ Shopify checkout                                            | ✅     | সব কেনা Shopify-র কার্ট আর চেকআউটে; post-purchase অফার Shopify-র changeset দিয়ে                                                                                                                                          |
| ১.১.৪ শুধু সত্যি তথ্য                                             | ✅     | Recent Sales আসল অর্ডার থেকে, সাথে কতক্ষণ আগে (ডিফল্ট লেখা থেকে "just" বাদ, এই PR); কাউন্টডাউন নির্দিষ্ট শেষ সময়ে; স্টক আসল ইনভেন্টরি থেকে; Cart Notice বলে জিনিস রাখা নেই; রিভিউ শুধু ক্রেতার বা অন্য অ্যাপ থেকে CSV-তে |
| ১.১.৯ দাম বাড়ানোর আগে ক্রেতার সম্মতি                             | ✅     | প্রতিটা "কার্টে যোগ" ক্রেতার ক্লিকে, দাম দেখিয়ে; ফ্রি গিফট শুধু সত্যিই ফ্রি হলে থাকে                                                                                                                                     |
| ১.১.১০ সবচেয়ে সস্তা শিপিং ডিফল্ট                                 | —      | শিপিং বদলানো হয় না                                                                                                                                                                                                       |
| ১.১.৩, ১.১.৫–১.১.৮, ১.১.১১–১.১.১৬                                 | —      | থিম বিক্রি, মার্কেটপ্লেস, পেমেন্ট গেটওয়ে, POS, ঋণ ইত্যাদি নেই                                                                                                                                                            |
| ১.২.১–১.২.২ Shopify Billing, ঠিকমতো                               | ✅     | `app/shopify.server.ts`; আবার ইনস্টলে প্ল্যান নেই ধরে নতুন বিল চাওয়া হয়। ডেভেলপমেন্ট স্টোরে টেস্ট বিল (এই PR), যাতে রিভিউয়ার প্ল্যান নিতে পারেন                                                                        |
| ১.২.৩ প্ল্যান বদলানো                                              | ✅     | Plans পাতা, আগের subscription সাথে সাথে বদলায়                                                                                                                                                                            |
| ১.৩.১ রিভিউয়ের বিনিময়ে কিছু নয়                                 | ✅     | অ্যাপ App Store-এ রিভিউ চায় না                                                                                                                                                                                           |

### ২. কাজ আর ইনস্টল

| শর্ত                                                      | অবস্থা | কোথায় বা কেন                                                                                        |
| --------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| ২.১.১–২.১.২ কোনো ভুলের পাতা নয় (৪০৪, ৫০০)                | ⏳     | টেস্ট আছে; জমার আগে production-এ পুরো অ্যাপ একবার ঘুরে দেখা                                          |
| ২.১.৪ তথ্য মেলানো                                         | ✅     | সাবস্ক্রাইবার আর Shopify customer দুই দিকে                                                           |
| ২.২.১–২.২.২ Shopify API, অ্যাডমিনের ভেতরে                 | ✅     |                                                                                                      |
| ২.২.৩ নতুন App Bridge                                     | ✅     | `AppProvider` app-bridge.js আগে লোড করে                                                              |
| ২.২.৪ শুধু GraphQL Admin API                              | ✅     | REST Admin API কোথাও নেই                                                                             |
| ২.২.৫–২.২.৬ অ্যাডমিন extension পূর্ণ, বিজ্ঞাপন নয়        | ✅     | `extensions/segment-campaign`                                                                        |
| ২.২.৭–২.২.৯ Max modal, Sidekick                           | —      |                                                                                                      |
| ২.৩.১ ইনস্টল শুধু Shopify-র জায়গা থেকে                   | ✅     | অ্যাপের ঠিকানা সরাসরি খুললে দোকানের ঠিকানা লেখার ফর্ম আর নেই, Shopify অ্যাডমিনে যাওয়ার লিংক (এই PR) |
| ২.৩.২–২.৩.৪ ইনস্টল আর আবার ইনস্টলে আগে OAuth, তারপর অ্যাপ | ✅     | Shopify managed installation (TOML-এর scopes)                                                        |

### ৩. নিরাপত্তা

| শর্ত                                   | অবস্থা | কোথায় বা কেন                                                                                           |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| ৩.১.১ বৈধ TLS                          | ⏳     | হোস্টিং                                                                                                 |
| ৩.১.২ মেয়াদি offline token            | ✅     | `future.expiringOfflineAccessTokens`                                                                    |
| ৩.২ শুধু দরকারি scope                  | ✅     | প্রতিটার কারণ `shopify.app.toml`-এ; `read_all_orders` বা `read_advanced_dom_pixel_events` চাওয়া হয় না |
| ৩.২.৩ `write_checkout_extensions_apis` | ⏳     | post-purchase-এর অনুমতির সাথে Shopify দেয় (উপরে ৬)                                                     |

### ৪. লিস্টিং

| শর্ত                                              | অবস্থা | কী করতে হবে                                                                                                                                                          |
| ------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ৪.১ নাম আলাদা আর সব জায়গায় এক                   | ⏳     | উপরে ৩                                                                                                                                                               |
| ৪.২ দাম শুধু Pricing details-এ, পুরোটা            | ⏳     | Starter $৭.৯৯/মাস বা $৭৯.৯০/বছর, Professional $১৪.৯৯/মাস বা $১৪৯.৯০/বছর, ৭ দিনের ফ্রি ট্রায়াল, কোনো usage fee নেই। ছবি বা আইকনে দাম নয়                             |
| ৪.৩.১ Online Store লাগে                           | ⏳     | "Merchant must have online store" টিক                                                                                                                                |
| ৪.৩.২ ভাষা                                        | ⏳     | শুধু English (অ্যাডমিন এখন শুধু ইংরেজিতে)                                                                                                                            |
| ৪.৩.৩–৪.৩.৭ সংখ্যা, "সেরা"-ধরনের দাবি, রিভিউ নয়  | ⏳     | লেখায় আর ছবিতে; "the best", "the only", "#1" নয়                                                                                                                    |
| ৪.৩.৮ কোন দোকানে চলে                              | ⏳     | Details-এ লিখুন: চেকআউটের আপসেল শুধু Shopify Plus-এ দেখায়                                                                                                           |
| ৪.৪ পরিষ্কার বর্ণনা আর ছবি                        | ⏳     | app card subtitle-এ কীওয়ার্ড ঠাসা নয়; স্ক্রিনশটে আসল অ্যাপ (ব্রাউজারের ফ্রেম বা ডেস্কটপ নয়), প্রতিটা আলাদা; Shopify-র লোগো নয়; নিজের অন্য অ্যাপ বা সেবার কথা নয় |
| ৪.৫.১–৪.৫.২ সাধারণ অ্যাপ, sales channel নয়       | ✅     |                                                                                                                                                                      |
| ৪.৫.৩–৪.৫.৬ ভিডিও, নির্দেশনা, চাবি, জরুরি যোগাযোগ | ⏳     | উপরে ২, ৮, ৯                                                                                                                                                         |

### ৫. অ্যাপের ধরন অনুযায়ী

| শর্ত                                           | অবস্থা | কোথায় বা কেন                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ৫.১.১–৫.১.৪ থিম শুধু theme app extension দিয়ে | ✅     | [built-for-shopify.md](built-for-shopify.md)-এর "দোকানের থিম" অংশ                                                                                                                                                                                       |
| ৫.১.৫ দোকানে নেওয়া তথ্য মার্চেন্ট দেখতে পান   | ✅     | ফর্মের ইমেইল Shopify-র Visitor API-তে যায়; অ্যাপে দেখা যায় সাবস্ক্রাইবার (Pop-up, Spin the Wheel), রিভিউ, চ্যাট, প্রত্যাহারের অনুরোধ, আর এখন Back in Stock-এর অনুরোধও (`/app/back-in-stock`, এই PR)। Order Tracker কিছু রাখে না                       |
| ৫.৬ চেকআউটের আপসেল                             | ✅     | `extensions/checkout-upsell`: নাম, ছবি আর দাম Shopify থেকে; ক্রেতা চাপলে তবেই যোগ; টাইমার নেই; কোনো তথ্য নেয় না                                                                                                                                        |
| ৫.৮ পেমেন্টের পরের অফার                        | ✅     | `extensions/post-purchase`: একটাই অফার, "Add to order" আর "No thanks" বদলানো যায় না, দাম-শিপিং-ট্যাক্স-মোট দেখায় আর ভ্যারিয়েন্ট বদলালে নতুন হিসাব, শেষে অর্ডার কনফার্মেশনে ফেরে। ব্যানারে প্রোডাক্টের নাম আর ছাড়, পাশে দোকানের আসল দাম কাটা (এই PR) |

## রিভিউয়ারের জন্য নির্দেশনার খসড়া

Partner Dashboard-এর "Testing instructions"-এ পেস্ট করার জন্য (নাম ঠিক হলে AllInOne বদলাবেন):

```text
1. Install the app from the listing. After approving the permissions you land on the AllInOne
   dashboard inside your Shopify admin.
2. Choose a plan: Plans > Starter or Professional > approve the charge. On development stores this
   is a test charge and nothing is billed. You can switch plans on the same page at any time.
3. Turn on the app embed: Dashboard > Get started > Open theme editor, switch on "AllInOne" under
   App embeds and save.
4. Turn on a tool: Tools > switch a tool on (open it to change its settings), then open your
   storefront. Widgets find their spot by themselves on most themes; Tools > Widget placement opens
   the theme editor if you want to move one.
5. Back in Stock: on a sold-out variant, leave an email in the form. The request appears under
   Tools > Back in Stock > View requests.
6. Post-purchase offer: Offers > New upsell, tick "One-click offer after payment" and save. Then
   select AllInOne in Settings > Checkout > Post-purchase page and place a test order with the
   Bogus Gateway.
7. Checkout upsell (Shopify Plus checkout only): tick "In checkout, under the order summary" on an
   upsell, then add the "Checkout upsell" block in the checkout editor.
8. Email campaigns and automations: Marketing. Emails are sent from our servers; send a test to
   your own address from the campaign editor.
9. AI tools: AI Studio. Each plan includes AI credits, so no key is needed.
```

## বেটার সময় যা দেখতে হবে

- রিভিউয়ারের মতো একটা নতুন ডেভেলপমেন্ট স্টোরে production অ্যাপ ইনস্টল করে প্ল্যান নেওয়া, প্ল্যান বদলানো, আনইনস্টল
  করে আবার ইনস্টলে আবার বিল চাওয়া হয় কিনা।
- পেমেন্টের পরের অফারে শতাংশ আর নির্দিষ্ট টাকার দুই রকম ছাড়েই ব্যানার আর কাটা দাম ঠিক দেখায় কিনা, অন্য মুদ্রাতেও।
