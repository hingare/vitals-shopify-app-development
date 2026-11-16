import type { Comparison } from "../../types";

/**
 * Comparisons. We don't name other apps: the honest comparisons are with "several separate apps"
 * and with what Shopify already gives every store for free.
 */
export const comparisons: Comparison[] = [
  {
    slug: "all-in-one-vs-separate-apps",
    title: "One all-in-one app or a dozen separate apps?",
    description:
      "What changes for cost, speed, clashes and upkeep when one app replaces many single-purpose Shopify apps, and when separate apps are still the better choice.",
    updated: "2026-11-16",
    body: [
      {
        type: "p",
        text: "Most stores add apps one problem at a time: reviews, then a pop-up, a sticky cart, an upsell app, a currency converter. Each choice makes sense on its own. Together they become a stack of bills, scripts and settings screens. Here's an honest look at both ways of working.",
      },
      {
        type: "table",
        headers: ["", "Separate apps", "{brand}"],
        rows: [
          [
            "Billing",
            "One charge per app, and some add usage fees",
            "One flat price ({starterPrice} or {proPrice} a month), no usage fees",
          ],
          [
            "Code in your store",
            "Each app loads its own scripts and styles",
            "One loader under 5 KB, and only the tools you turn on",
          ],
          ["Settings", "A different admin for each app", "One admin inside Shopify"],
          [
            "Overlaps",
            "Two apps can fight over the same spot or discount",
            "Overlapping tools are flagged, and an item never gets two offers",
          ],
          [
            "Depth in one area",
            "Often deeper, because it's all the app does",
            "Covers what most stores need in each area",
          ],
        ],
      },
      { type: "h2", text: "Cost" },
      {
        type: "p",
        text: "Add up what you pay for each app today, including any usage charges on your Shopify invoice. {brand} costs {starterPrice} a month for {starterTools} tools, or {proPrice} for all {proTools}, with AI credits, emails and recordings included up to a monthly limit. When a limit is reached, that feature pauses until next month instead of charging more.",
      },
      { type: "h2", text: "Speed" },
      {
        type: "p",
        text: "Every app that shows something in your store adds code that shoppers' phones have to download and run. Several apps doing similar jobs often load several copies of similar code. {brand} loads one small script after your page has loaded, and then only the tools you switched on, each in its own file of 10 KB or less.",
      },
      {
        type: "p",
        text: "Don't take our word for it: measure your store's mobile speed before and after with [Speed Guard](/help/speed-guard) or Google's PageSpeed Insights.",
      },
      { type: "h2", text: "Clashes" },
      {
        type: "p",
        text: "Two cart drawers, two sticky bars or two discount apps can get in each other's way, and it's hard to tell which one caused a problem. Inside one app, tools that would do the same job warn you, and offers share one set of rules for what happens when they overlap.",
      },
      { type: "h2", text: "Upkeep and uninstalling" },
      {
        type: "p",
        text: "Fewer apps means fewer settings screens, fewer updates to keep an eye on and fewer support teams to contact. {brand} adds itself to your theme only through Shopify's app embed and blocks, which Shopify removes automatically when you uninstall.",
      },
      { type: "h2", text: "When separate apps are the better choice" },
      {
        type: "list",
        items: [
          "You need one area to go very deep, such as a loyalty program, subscriptions or SMS marketing. {brand} doesn't do those, and a specialist will serve you better.",
          "You only need one or two tools. A single small app may cost less.",
          "Your team already runs a full email platform. You can keep it and connect it: {brand} sends new subscribers to Klaviyo, Mailchimp or Omnisend.",
        ],
      },
      {
        type: "note",
        text: "A good way to decide: list the apps you use, check which of them [our tools](/tools) cover, and try {brand} free for {trialDays} days before removing anything.",
      },
    ],
  },
  {
    slug: "vs-shopify-free-features",
    title: "{brand} and Shopify's free features",
    description:
      "Shopify gives every store more for free than many merchants realize. What Shopify already does, where this app adds to it, and when you don't need us.",
    updated: "2026-11-16",
    body: [
      {
        type: "p",
        text: "Before paying for any app, check what Shopify already includes. For several jobs, Shopify's own option is the right one, and we'll say so. Here's how the two fit together.",
      },
      {
        type: "table",
        headers: ["What you need", "Shopify's free option", "What {brand} adds"],
        rows: [
          [
            "Prices in local currencies",
            "Shopify Markets, with local prices at checkout too",
            "[Currency Converter](/tools/currency-converter) for stores not using Markets for this. It switches itself off when Markets shows local currencies.",
          ],
          [
            "Cookie consent",
            "The cookie banner in Shopify's customer privacy settings",
            "[Cookies Banner](/tools/cookies-banner) with your own texts and position. It stays hidden if Shopify's banner is on.",
          ],
          [
            "Country suggestions",
            "Shopify's free Geolocation app",
            "[Geolocation Redirect](/tools/geolocation-redirect), which can also send visitors to your own stores for other countries.",
          ],
          [
            "Chat with shoppers",
            "Shopify Inbox",
            "[Live Chat](/tools/live-chat) answered from the same app, with replies by email when the shopper has left, or [Chat Button](/tools/chat-button) for WhatsApp, Messenger and Telegram.",
          ],
          [
            "Email marketing",
            "Shopify Email",
            "Campaigns and four automatic emails on Professional, up to {emails} a month, plus syncing to Klaviyo, Mailchimp or Omnisend.",
          ],
          [
            "Search and recommendations",
            "Shopify's Search & Discovery app",
            "[Instant Search](/tools/instant-search) and [Related Products](/tools/related-products), which build on Shopify's own search and recommendations instead of replacing them.",
          ],
          [
            "Discounts and bundles",
            "Shopify's discounts and its free Bundles app",
            "One offer engine for volume tiers, bundles, free gifts, buy X get Y and upsells, with rules for who sees each offer, A/B tests and a report per offer.",
          ],
        ],
      },
      { type: "h2", text: "When Shopify's own option is enough" },
      {
        type: "list",
        items: [
          "You sell in several countries with Shopify Markets. Use Markets for currencies: it also charges in the local currency. That's why our Currency Converter, Cookies Banner and Geolocation Redirect start switched off.",
          "You only want to answer chat messages from your phone. Shopify Inbox is free and does that well.",
          "You need a simple discount for a sale. Shopify's own discounts are enough; our offer engine is for tiers, gifts, bundles and upsells with rules and reports.",
        ],
      },
      { type: "h2", text: "Where {brand} adds the most" },
      {
        type: "p",
        text: "Most of the app covers things Shopify doesn't offer on its own: a sticky Add to cart bar, trust and payment badges, a cart drawer, free gifts, low-stock messages from your real inventory, countdowns to real sale end dates, product labels, size charts, reviews with importing, results by tool, and AI tools for writing, photos and video. See [all {proTools} tools](/tools).",
      },
    ],
  },
];
