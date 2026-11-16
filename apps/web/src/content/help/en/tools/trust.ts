import type { ToolArticle } from "../../types";

/** Trust, reviews, protect and local tools */
export const trust: Record<string, ToolArticle> = {
  "trust-seals": {
    intro:
      "Trust Seals shows a row of badges like Secure checkout, Free shipping and Money-back guarantee below the Add to cart button. They answer the questions shoppers have right before they buy.",
    setup: [
      "Pick the **Badges** to show. Only choose promises your store really keeps, such as free shipping only if every order ships free.",
      "Add a **Heading** above the badges if you like, and set the **Icon size**.",
      "Turn on **Also show on the cart page** to repeat them near the checkout button.",
      "Pick **Colors** that suit your theme.",
    ],
    after: [
      "To place the badges somewhere else on the product page, use the [App widget block](/help/widget-placement) and choose Trust badges.",
    ],
    related: ["payment-logos", "shipping-info", "widget-placement"],
  },

  "payment-logos": {
    intro:
      "Payment Logos shows the logos of the payment methods your store accepts, on product pages, in the cart and optionally in the footer. The list comes from your Shopify payment settings, so it updates by itself.",
    setup: [
      "Change the **Heading** if you like.",
      "Choose where to show the logos: product pages, the cart page and the footer.",
      "Set the **Icon size**, and turn on **Gray logos** for a quieter look.",
    ],
    tips: [
      "Many themes can already show payment icons in the footer. If yours does, keep **Show in the footer** off so they don't appear twice.",
    ],
    related: ["trust-seals", "widget-placement"],
  },

  "shipping-info": {
    intro:
      "Shipping Info shows an estimated delivery date range on product pages, plus how long is left to order for same-day shipping. Shoppers know when their order arrives before they buy.",
    setup: [
      "Set **Fastest delivery (days)** and **Slowest delivery (days)** to match your real shipping times.",
      "Keep **Don't count Saturdays and Sundays** on if your carriers don't deliver at weekends.",
      "Set the **Same-day shipping cutoff** hour. It uses your store's time zone from Shopify's Settings > General.",
      "Edit the messages if you like. `{start}` and `{end}` are the dates, and `{time}` is the time left before the cutoff. Empty the cutoff message to hide it.",
    ],
    tips: [
      "Use your slowest real times rather than the best case. An order that arrives early makes a happier customer than one that arrives late.",
    ],
    related: ["trust-seals", "order-tracker", "widget-placement"],
  },

  "recent-sales": {
    intro:
      "Recent Sales Notifications shows small pop-ups about real recent orders, with the product's photo and name and how long ago it was bought. No customer names, cities or addresses are shown, and nothing appears until your store has real sales.",
    setup: [
      "Edit the **Message**. `{product}` is replaced with the product name.",
      "Set **Show sales from the last (days)**. Older sales are never shown.",
      "Set when the first pop-up appears, the time between pop-ups and how long each stays.",
      "Pick the **Position**, whether to **Show on mobile**, and **Colors**.",
    ],
    after: [
      "Sales are added as orders are paid, so a new store sees nothing at first. The pop-ups start after your first paid orders.",
    ],
    faq: [
      {
        q: "Can I show sample sales until I get real ones?",
        a: "No. Invented sales mislead shoppers and are treated as misleading by consumer protection rules in many countries, so the tool only shows real orders.",
      },
    ],
    related: ["product-reviews", "stock-scarcity"],
  },

  "agree-to-terms": {
    intro:
      "Agree to Terms adds a checkbox next to the checkout button in the cart and cart drawer. Shoppers have to tick it to agree to your terms before they can check out.",
    setup: [
      "Edit the **Checkbox text**. `{terms}` becomes a link with the **Link text** you set.",
      "Set the **Terms page**. The default is the terms of service page Shopify creates under Settings > Policies.",
      "Edit the **Message if not ticked** and pick **Colors**.",
    ],
    tips: [
      "Buy it now and express buttons skip the cart, and the checkbox with it. If every order must agree, also turn on [Hide Dynamic Checkout Buttons](/help/hide-dynamic-checkout) for product and cart pages.",
    ],
    related: ["hide-dynamic-checkout", "cart-notice", "cart-drawer"],
  },

  "product-reviews": {
    intro:
      "Product Reviews collects reviews with star ratings and photos on your product pages and shows them to shoppers. Ratings are saved to your products in Shopify, so many themes can show stars in product lists, and Google can show them in search results.",
    setup: [
      "Choose **Publish new reviews automatically**: none (you approve each one), 4 stars and up, or all.",
      "Set **Reviews per page**.",
      "Keep **Let shoppers write reviews** on to show the review form, and decide whether to **Let shoppers add photos**. Photos are saved in your own Shopify Files.",
      "Pick the **Star color**.",
    ],
    after: [
      "Reviews appear at the bottom of product pages. To move them, or to add the star rating under the product title, open the theme editor and add the **Product reviews** or **Star rating** block to your product page.",
      "Open **Reviews** in the app to publish, reject, delete or reply to reviews.",
      "Read [Managing reviews](/help/managing-reviews) for store reviews, importing from another app and asking customers for reviews by email.",
    ],
    tips: [
      "Look for a setting like Show product rating in your theme's product card settings. It reads the same ratings and shows stars in collections.",
    ],
    faq: [
      {
        q: "Can I import reviews from my old app?",
        a: "Yes. Export a CSV from Judge.me, Loox, Shopify Product Reviews or another app, then open Reviews in the app and choose Import reviews. See [Managing reviews](/help/managing-reviews).",
      },
      {
        q: "Are emails of reviewers shown in my store?",
        a: "No. Shoppers see the reviewer's first name and the first letter of their last name. Emails are never shown.",
      },
    ],
    related: ["managing-reviews", "ai-review-summary", "email-marketing"],
  },

  "content-protection": {
    intro:
      "Content Protection makes it harder to copy your product photos and text by blocking right-click, dragging, selecting and copy shortcuts. It stops casual copying, but nothing on the web can stop a determined copier, since the browser has to download what it shows.",
    setup: [
      "Keep **Stop right-click and dragging on images** on. This is the part that matters most.",
      "Turn on the other options only if you need them: blocking text selection and right-click everywhere also gets in the way of honest shoppers, for example when copying an order number.",
    ],
    tips: [
      "Watermarks on your photos protect them better than any script. Combine both if copying is a real problem in your niche.",
    ],
    related: ["best-sellers-protection"],
  },

  "eu-withdrawal": {
    intro:
      "EU Withdrawal Button adds the withdrawal link and form that EU consumer rules require for online purchases. Customers fill in the form, get an email confirming what they sent with the date and time, and you see every request in the app.",
    setup: [
      "Edit the texts of the link, the form and the confirmation email if you like. `{name}` and `{order}` in the email are replaced with the customer's details.",
      "Keep **Show in the footer** on so the withdrawal link is on every page, as the rules ask.",
      "Pick **Colors** for the form.",
    ],
    after: [
      "The form lives at `/apps/app-tools/withdraw` in your store. Every other page links to it from the footer.",
      "Open **Withdrawal requests** from the tool page in the app to see requests and mark them as handled. Refunds and returns are still done by you in Shopify.",
      "Add a reply-to email on the Marketing page to get an email each time a request comes in.",
    ],
    tips: [
      "Confirmation emails need email sending to be set up, and they don't count toward your monthly email limit.",
    ],
    related: ["email-sending", "privacy-data", "agree-to-terms"],
  },

  "best-sellers-protection": {
    intro:
      "Best Sellers Protection removes the Best selling option from the sort menu on collection pages, and sends visitors who open a best-selling link to the normal order. It makes it harder for competitors to see your top products at a glance.",
    setup: [
      "Keep **Remove Best selling from the sort menu** on.",
      "Keep **Send visitors who open a best-selling link to the normal order** on, so the sorted list can't be opened directly.",
    ],
    tips: [
      "If you set a collection's own sort order to Best selling in Shopify, that collection is left alone, because you chose to show that order.",
      "It stops casual snooping, not every method. Tools that estimate sales from outside your store can still guess.",
    ],
    related: ["content-protection"],
  },

  "currency-converter": {
    intro:
      "Currency Converter lets shoppers see prices in their own currency while they browse. Checkout stays in your store currency, and a note tells shoppers so. It switches itself off when Shopify Markets already shows local currencies.",
    setup: [
      "Check first whether Shopify Markets can do this for you: in Shopify, open Settings > Markets. Markets shows real local prices at checkout too, which is better when it's available.",
      "Pick the **Currencies shoppers can pick**.",
      "Keep **Pick the shopper's currency automatically** on to start with the currency of their country.",
      "Edit the **Note about checkout currency** and choose the **Position** of the currency picker.",
    ],
    tips: [
      "Exchange rates refresh about twice a day, so converted prices are close but not exact. The amount charged is always the one in your store currency.",
    ],
    faq: [
      {
        q: "Why doesn't the converter show up?",
        a: "It stays off when Shopify Markets already shows more than one currency in your store, so shoppers never see two converters. This tool also starts switched off: turn on Enabled and save.",
      },
    ],
    related: ["geolocation-redirect", "languages"],
  },

  "cookies-banner": {
    intro:
      "Cookies Banner asks visitors for cookie consent and passes their choice to Shopify, so Shopify, this app and your other apps all follow it. It stays hidden if Shopify's own cookie banner is turned on.",
    setup: [
      "Check Shopify's own banner first: in Shopify, open Settings > Customer privacy. If it's on and you're happy with it, keep this tool off.",
      "Edit the **Message**, the button texts and the **Privacy policy page** link.",
      "Keep **Only show where the law requires it** on to show the banner only to visitors in the EU, the UK and other regions that require consent.",
      "Choose the **Position** and **Colors**.",
    ],
    tips: [
      "Visitor analytics and recordings in this app only run for visitors who allow analytics, whichever banner you use.",
    ],
    related: ["privacy-data", "visitor-recordings", "facebook-pixels"],
  },

  "geolocation-redirect": {
    intro:
      "Geolocation Redirect suggests the right country store to visitors from other countries, with a small message and Switch and Stay buttons. It uses your Shopify Markets, or your own links to other stores.",
    setup: [
      "Check Shopify's free Geolocation app first. If it already does what you need, keep this tool off.",
      "Edit the **Message** and button texts. `{country}` is the visitor's country.",
      "If you have separate stores for some countries, add **Your own country links**, one per line, like `BD=https://bd.example.com`. Countries without a link use your Shopify Markets.",
      "Pick **Colors**.",
    ],
    tips: [
      "Visitors are never moved without clicking Switch, and the choice is remembered so they aren't asked on every page.",
    ],
    related: ["currency-converter", "languages"],
  },
};
