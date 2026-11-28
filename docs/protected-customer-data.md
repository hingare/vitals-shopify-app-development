# ক্রেতার তথ্য (Protected customer data): আবেদন আর আমাদের অবস্থা

অ্যাপের লাগে Shopify-র **লেভেল ২**: "Customer data", আর তিনটা ফিল্ড **Name, Email, Phone**। Address লাগে না।
ডেভেলপমেন্ট স্টোরে শুধু বেছে Save করলেই চলে, কোনো রিভিউ নেই। আসল দোকানে বসাতে অ্যাপ App Store রিভিউতে জমা
দিলে Shopify এটাও যাচাই করে, আর তখন নিচের শর্তগুলো সত্যি হতে হবে। সূত্র: Shopify-র
[Work with protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data) (২০২৬-১১-২৮-এ পড়া)।

এটা না করলে Shopify `customers`, `checkouts` আর `orders` webhook দেয় না বা ক্রেতার ঘরগুলো ফাঁকা পাঠায়, আর
ক্রেতার তালিকা পড়ার query error দেয়। তাই ডেভ স্টোরে পরীক্ষার আগেই করতে হবে।

## কোথায় করবেন

1. Dev Dashboard → Apps → অ্যাপ (এখন AllInOne Dev) → Settings → Access requests → Protected customer data →
   Manage। (distribution আগে বাছতে হয়; আমাদের Public বাছা আছে।)
2. **Customer data**-তে টিক, নিচের "Customer data" কারণ দিন, Apply reasons।
3. **Name, Email, Phone**-এ টিক (Address নয়), প্রতিটার কারণ দিন, Apply reasons।
4. **Data protection details**: নিচের তালিকার উত্তর।
5. Save। ডেভ স্টোরের জন্য এখানেই শেষ। আসল দোকানের জন্য অ্যাপ রিভিউতে জমা দিলে Shopify দেখে, আর ইমেইল ও
   Dev Dashboard-এ ফল জানায়।

ফর্মে কারণের তৈরি তালিকা থাকলে যেগুলো মেলে বাছুন; লেখার ঘরে নিচের ইংরেজি লেখাগুলো দিন।

## কোন তথ্য, কোথায়, কেন

| তথ্য                            | কোথা থেকে                                                                            | কোন টুলে, কেন                                                                                                                                      | আমাদের কাছে কতদিন                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Email                           | `orders/paid`, `orders/create`, `checkouts`, `customers` webhook; customers query    | মার্কেটিং ইমেইল আর flow (welcome, abandoned checkout, review request, win-back), সম্মতি Shopify-র সাথে মেলানো, segment ক্যাম্পেইন, wishlist ইভেন্ট | সাবস্ক্রাইবার অ্যাপ থাকা পর্যন্ত; abandoned checkout ৩০ দিন; পাঠানো ইমেইলের খাতা ১৮০ দিন                                   |
| Email                           | Order Tracker-এর orders query                                                        | ক্রেতা অর্ডার নম্বর আর ইমেইল দিলে মিলিয়ে দেখা                                                                                                     | রাখা হয় না                                                                                                                |
| Name (শুধু first name)          | `orders/paid`, `checkouts` webhook; customers query                                  | ইমেইলে "Hi Anna" লেখা                                                                                                                              | সাবস্ক্রাইবারের সাথে; abandoned checkout ৩০ দিন                                                                            |
| Phone                           | Order Tracker-এর orders query (অর্ডার, shipping আর billing-এর ফোন)                   | ক্রেতা অর্ডার নম্বর আর ফোন দিলে মিলিয়ে দেখা; ফোন কখনো দেখানো হয় না                                                                               | রাখা হয় না                                                                                                                |
| Customer ID, অর্ডার             | webhook আর Admin API                                                                 | অফার আর ইমেইল থেকে কত বিক্রি (attribution), চেকআউট ফিরল কিনা, লগইন করা ক্রেতার wishlist, চ্যাট আর রেকর্ডিং তাঁর সাথে জোড়া                         | wishlist অ্যাপ থাকা পর্যন্ত; চ্যাট শেষ বার্তার ১৮০ দিন পরে; রেকর্ডিং ৩০ দিন                                                |
| স্টোরফ্রন্টের ফর্মে দেওয়া তথ্য | পপআপ, Spin Wheel, Back in Stock, রিভিউ, Live Chat, EU Withdrawal (ক্রেতা নিজে লেখেন) | Shopify-র API-র বাইরে, তবু একই নিয়ম মানা হয়                                                                                                      | Spin Wheel ১ বছর; স্টক অ্যালার্ট জানানোর ৩০ দিন পরে (অপেক্ষায় থাকলে বড়জোর ১ বছর); রিভিউ আর withdrawal অ্যাপ থাকা পর্যন্ত |

আর কোথাও ক্রেতার তথ্য যায় না: web pixel আর Meta pixel কখনো নাম, ইমেইল, ফোন বা ঠিকানা পাঠায় না
(`extensions/web-pixel`), অ্যাপের ত্রুটির খাতায় ইমেইল আর ফোন জমার আগেই মুছে ফেলা হয় (`errors.server.ts`), আর
Visitor Recordings ফর্মের লেখা ঢেকে রাখে আর অ্যাকাউন্ট, চেকআউট আর অর্ডারের পাতা কখনো রেকর্ড করে না। এক ক্রেতার
সব তথ্য কোন টেবিলে আছে, তা `app/lib/privacy.server.ts`-এ এক জায়গায় লেখা; GDPR export আর redact সেখান থেকেই হয়।
মার্চেন্ট আনইনস্টল করলে ৪৮ ঘণ্টা পরে Shopify-র `shop/redact` এলে দোকানের সব তথ্য মোছে।

## Dev Dashboard-এ যা লিখবেন

**Customer data**

```text
We use customer IDs and order data to run the tools the merchant turns on: counting the orders and revenue
that come from the app's offers and emails, marking abandoned checkouts as recovered, linking a logged-in
shopper's wishlist and live chat to their account, and keeping email marketing consent in sync with Shopify.
We do not sell or share this data, and each tool only processes it while the merchant has it turned on.
```

**Name**

```text
We use only the customer's first name, to greet them in the emails the merchant sends with the app
(welcome, abandoned checkout reminder, review request, win-back and campaigns). We never use last names.
```

**Email**

```text
We send the emails the merchant sets up in the app (abandoned checkout reminders, review requests after an
order, welcome, win-back and campaigns), marketing emails only to customers who agreed to receive them, and
keep that consent in sync with Shopify. If the merchant connects their own email tool
(Klaviyo, Mailchimp or Omnisend), we send it the same events for their customers. Shoppers can also look up
an order in the Order Tracker by its number and the order's email; we compare it and do not store it.
```

**Phone**

```text
Order Tracker only: a shopper can look up an order by its number and the phone number on the order. We
request the phone fields only for that lookup, compare them, and never store or show the phone number.
```

## Data protection details: উত্তর আর প্রমাণ

✅ কোডে বা নথিতে সত্যি। ⏳ হোস্টিং বা মালিকের কাজ বাকি; রিভিউতে জমার আগে করতে হবে।

| শর্ত                                            | উত্তর | কোথায় সত্যি                                                                                                                                                                      |
| ----------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| শুধু দরকারি ন্যূনতম তথ্য                        | ✅    | Address চাওয়া হয় না; webhook-এ `include_fields` দিয়ে শুধু দরকারি ঘর (`shopify.app.toml`); Order Tracker ফোন বা ইমেইল যেটা দিয়ে খোঁজা হয় শুধু সেটাই চায়                      |
| মার্চেন্টকে জানানো কী তথ্য, কেন                 | ✅    | Privacy Policy-তে টুল ধরে ধরে তথ্য আর সময় (`apps/web/src/content/legal/en.ts`); টুল চালু না করলে তার তথ্য নেওয়া হয় না                                                          |
| বলা কাজের বাইরে ব্যবহার নয়                     | ✅    | তথ্য বিক্রি বা অন্য কাজে ব্যবহার হয় না; ইমেইল টুলে যায় শুধু মার্চেন্ট নিজে সংযুক্ত করলে                                                                                         |
| ক্রেতার সম্মতি মানা                             | ✅    | মার্কেটিং ইমেইল শুধু রাজি ক্রেতাকে, প্রতিদিন Shopify-র সাথে মেলানো (`consent-check.server.ts`); pixel আর Recordings Customer Privacy API মানে                                     |
| তথ্য বিক্রি/শেয়ারে আপত্তি মানা                 | ✅    | আমরা তথ্য বিক্রি করি না; Meta pixel চলে শুধু মার্কেটিং আর sale-of-data দুই সম্মতি থাকলে (`meta.ts`)                                                                               |
| স্বয়ংক্রিয় সিদ্ধান্তে opt-out                 | ✅    | আইনি বা বড় প্রভাবের কোনো স্বয়ংক্রিয় সিদ্ধান্ত অ্যাপ নেয় না                                                                                                                    |
| মার্চেন্টের সাথে privacy/data protection চুক্তি | ⏳    | Terms আর Privacy Policy-তে আমরা processor, দোকান controller (খসড়া তৈরি); কোম্পানির নাম-ঠিকানা বসিয়ে আইনজীবীকে দেখিয়ে প্রকাশ করতে হবে                                           |
| তথ্য রাখার সময়সীমা                             | ✅    | প্রতি ঘণ্টায় `pruneMarketingData` (`jobs.server.ts`): চেকআউট ৩০ দিন, স্টক অ্যালার্ট ৩০ দিন/১ বছর, স্পিন ১ বছর, চ্যাট আর ইমেইলের খাতা ১৮০ দিন, রেকর্ডিং ৩০ দিন; আনইনস্টলে সব মোছে |
| পথে আর জমা অবস্থায় এনক্রিপশন                   | ⏳    | পথে HTTPS; সংযুক্ত সেবার চাবি এনক্রিপ্ট করে রাখা (`crypto.server.ts`); জমা অবস্থার জন্য হোস্টিং-এ এনক্রিপ্টেড ডিস্ক আর ডাটাবেসে TLS লাগবে                                         |
| ব্যাকআপ এনক্রিপ্ট (লেভেল ২)                     | ✅    | `db-backup.mjs` AES-256-GCM দিয়ে, `BACKUP_KEY` ছাড়া চলে না ([backup-restore.md](backup-restore.md))                                                                             |
| test আর production ডেটা আলাদা (লেভেল ২)         | ✅    | ডেভ চলে নিজের কম্পিউটারের ডাটাবেস আর ডেভ স্টোরে, CI নকল ডেটায়; প্রোডাকশনের ব্যাকআপ নিজের কম্পিউটারে নামানো হয় না, রিস্টোর মহড়া সার্ভারেই                                       |
| ডেটা ফাঁস ঠেকানোর পরিকল্পনা (লেভেল ২)           | ✅    | নিচের "ডেটা ফাঁস ঠেকানো" অংশ                                                                                                                                                      |
| কর্মীর প্রবেশ সীমিত (লেভেল ২)                   | ⏳    | প্রোডাকশন ডাটাবেস আর হোস্টিং-এর চাবি শুধু মালিকের কাছে; সাপোর্ট ডেস্কে (`/app/desk`) শুধু মার্চেন্টের টিকিট আর ক্রেতার তথ্য ছাড়া ত্রুটি। হোস্টিং ঠিক হলে এভাবেই রাখতে হবে        |
| কর্মীর শক্ত পাসওয়ার্ড (লেভেল ২)                | ⏳    | Dev Dashboard, GitHub, হোস্টিং, Cloudflare আর ইমেইল সেবায় password manager-এর পাসওয়ার্ড আর দুই ধাপের লগইন (2FA) চালু রাখা                                                       |
| ক্রেতার তথ্যে প্রবেশের খাতা (লেভেল ২)           | ⏳    | হোস্টিং-এ ডাটাবেসের লগইনের লগ চালু রাখা; সমস্যা ঠিক করতে কখনো ক্রেতার সারি খুললে তারিখ, দোকান আর কারণ লিখে রাখা                                                                   |
| নিরাপত্তার ঘটনার নিয়ম (লেভেল ২)                | ✅    | নিচের "নিরাপত্তার ঘটনা হলে" অংশ                                                                                                                                                   |

## হোস্টিং বাছাইয়ের সময় যা মিলিয়ে নেবেন

- ডাটাবেস আর ফাইল রাখার ডিস্ক এনক্রিপ্ট করা (বেশিরভাগ managed PostgreSQL নিজে থেকেই করে; লিখিত দেখে নিন)।
- অ্যাপ থেকে ডাটাবেসে TLS (`DATABASE_URL`-এ `sslmode=require`), যদি ডাটাবেস একই private network-এ না থাকে।
- point-in-time recovery, অন্তত ৭ দিন ([backup-restore.md](backup-restore.md))।
- ডাটাবেসের লগইনের লগ, আর হোস্টিং অ্যাকাউন্টে 2FA।
- প্রোডাকশনের `.env` শুধু সার্ভারে আর password manager-এ।

## ডেটা ফাঁস ঠেকানো

- কম তথ্য: Address নেওয়া হয় না, শুধু first name, আর প্রতিটা টুল বন্ধ থাকলে তার তথ্য নেওয়া হয় না।
- সময় পেরোলে মোছা (ওপরের সময়সীমা), আর এক ক্রেতা বা পুরো দোকান মুছতে বললে সব টেবিল থেকে মোছা।
- এনক্রিপশন: পথে HTTPS, ব্যাকআপ AES-256-GCM, সংযুক্ত সেবার চাবি এনক্রিপ্ট করা।
- লগে ক্রেতার তথ্য নয়: ত্রুটির খাতা জমার আগে ইমেইল আর ফোন মোছে; pixel কোনো ব্যক্তিগত তথ্য পাঠায় না।
- বাইরে যাওয়া সীমিত: তথ্য নামানো (export) যায় শুধু মার্চেন্টের অ্যাডমিন থেকে, তাঁর নিজের দোকানের; Order Tracker
  উত্তরে কখনো ইমেইল, ফোন বা ঠিকানা দেয় না; স্টোরফ্রন্টের ফর্মে rate limit।
- প্রোডাকশনের তথ্য ডেভ, CI বা নিজের কম্পিউটারে আনা হয় না।

## নিরাপত্তার ঘটনা হলে

এটাই আমাদের security incident response policy। ঘটনা মানে ক্রেতা বা মার্চেন্টের তথ্য অনুমতি ছাড়া কেউ দেখেছে,
নিয়েছে, বদলেছে বা মুছেছে, বা তার সন্দেহ।

1. **ধরা পড়া:** ত্রুটির ইমেইল, হোস্টিং-এর alert, GitHub-এর security alert, মার্চেন্ট বা Shopify-র খবর। যে-ই
   দেখুক, মালিককে সাথে সাথে জানান।
2. **থামানো:** যে চাবি বা পাসওয়ার্ড ফাঁস হয়েছে বা হতে পারে তা বদলান (Shopify API secret, ডাটাবেসের পাসওয়ার্ড,
   R2 token, সংযুক্ত সেবার এনক্রিপশন চাবি, `BACKUP_KEY`), সন্দেহজনক প্রবেশ বন্ধ করুন, দরকার হলে অ্যাপ সাময়িক বন্ধ
   রাখুন।
3. **মাপা:** কোন তথ্য, কোন দোকান, কতজন ক্রেতা, কোন সময়ে; লগ থেকে প্রমাণ রেখে দিন।
4. **জানানো:** ক্ষতিগ্রস্ত মার্চেন্টদের দেরি না করে জানান (তাঁদের ক্রেতার তথ্যে আমরা processor; তাঁদের নিজেদের আইনি
   সময়সীমা থাকে, যেমন GDPR-এ কর্তৃপক্ষকে ৭২ ঘণ্টা)। Shopify-কেও জানান। মার্চেন্ট বা ওয়েবসাইটের ভিজিটরের তথ্যে
   আমরা controller, তাই যেখানে আইন বলে সেখানে কর্তৃপক্ষকে ৭২ ঘণ্টার মধ্যে।
5. **সারানো আর শেখা:** কারণ ঠিক করুন, দরকার হলে ব্যাকআপ থেকে ফেরান, আর এক পাতায় লিখে রাখুন কী ঘটেছিল, কেন,
   কী করা হলো আর আবার যাতে না ঘটে তার জন্য কী বদলানো হলো।
