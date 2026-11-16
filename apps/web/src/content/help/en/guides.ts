import type { Guide } from "../types";

/**
 * Help guides that are not about a single tool. Plan facts (prices, limits, trial days) are written
 * as `{name}` placeholders and filled in from @app/tool-sdk when the page is built, so they always
 * match what the app bills.
 */
export const guides: Guide[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    description:
      "Install the app, turn on the app embed, choose a plan and switch on your first tools. It takes about ten minutes.",
    body: [
      {
        type: "p",
        text: "Everything happens inside your Shopify admin, and nothing is pasted into your theme code. Follow these steps once and you're ready to turn on any tool.",
      },
      { type: "h2", text: "1. Measure your speed first" },
      {
        type: "p",
        text: "Open **Speed Guard** in the app and press **Measure now** before you turn anything on. This saves your store's mobile speed score from before the app, so you can compare later. See [Speed Guard](/help/speed-guard).",
      },
      { type: "h2", text: "2. Turn on the app embed" },
      {
        type: "steps",
        items: [
          "On the app's **Dashboard**, press **Open theme editor** next to Turn on the app embed in your theme.",
          "In the theme editor, make sure **App tools** is switched on under App embeds.",
          "Press **Save** in the theme editor.",
        ],
      },
      {
        type: "p",
        text: "The app embed is the one switch that lets tools show in your store. See [The app embed](/help/app-embed) if you can't find it.",
      },
      { type: "h2", text: "3. Choose a plan" },
      {
        type: "p",
        text: "Open **Plans** and pick Starter ({starterPrice} a month) or Professional ({proPrice} a month). Both start with a {trialDays}-day free trial, and Shopify bills you on your normal invoice. See [Plans and billing](/help/plans-billing).",
      },
      { type: "h2", text: "4. Turn on your first tools" },
      {
        type: "steps",
        items: [
          "Open **Tools**. Use the search box or the category menu to find a tool.",
          "Press **Configure** to see its settings and a preview, change what you like, turn on **Enabled** and press **Save**.",
          "Open your store in a new tab to see it working.",
        ],
      },
      {
        type: "note",
        text: "Good first tools for most stores: [Product Reviews](/help/product-reviews), [Trust Seals](/help/trust-seals), [Free Gifts](/help/free-gifts) or [Volume Discounts](/help/volume-discounts), and [Cart Drawer](/help/cart-drawer).",
      },
      { type: "h2", text: "5. Check the results" },
      {
        type: "p",
        text: "After a few days, open **Analytics** to see views, clicks, add to carts and orders for each tool. Keep what works and switch off what doesn't. See [Analytics](/help/analytics).",
      },
    ],
    related: ["app-embed", "plans-billing", "widget-placement"],
  },

  {
    slug: "app-embed",
    title: "The app embed",
    description:
      "The app embed is the switch in your theme that lets the app's tools show in your store. Turn it on once per theme.",
    body: [
      {
        type: "p",
        text: "Shopify lets apps add things to your storefront through app embeds, which you control from the theme editor. This app has one embed, called **App tools**. It loads a small script of under 5 KB after your page has loaded, which then loads only the tools you have switched on.",
      },
      { type: "h2", text: "Turn it on" },
      {
        type: "steps",
        items: [
          "Open the app's **Dashboard** and press **Open theme editor**. The editor opens on the App embeds panel.",
          "Switch on **App tools**.",
          "Press **Save** in the top right of the theme editor.",
        ],
      },
      {
        type: "p",
        text: "You can also get there from Shopify: **Online Store > Themes > Customize**, then the **App embeds** icon in the left sidebar.",
      },
      { type: "h2", text: "Check that it's on" },
      {
        type: "p",
        text: "The Dashboard shows **App embed is on** once Shopify reports it as on for your live theme.",
      },
      {
        type: "note",
        text: "App embeds belong to a theme. When you publish a new theme, or a copy of your theme, turn on App tools in that theme too.",
      },
      {
        type: "faq",
        items: [
          {
            q: "Do I need the app embed for every tool?",
            a: "For every tool that shows something in your store, yes. Tools that work inside the app, like AI Studio, SEO Alt Tags and email campaigns, work without it.",
          },
          {
            q: "What happens to the embed when I uninstall?",
            a: "Shopify removes it from your themes automatically. Nothing is left behind in your theme code.",
          },
        ],
      },
    ],
    related: ["getting-started", "widget-placement", "troubleshooting"],
  },

  {
    slug: "widget-placement",
    title: "Where widgets appear",
    description:
      "Widgets find the right spot on most themes by themselves. Here's how to move one with the App widget block, or set a custom position.",
    body: [
      {
        type: "p",
        text: "Product page widgets, like Trust Seals, Countdown Timer and Shipping Info, place themselves next to your theme's Add to cart button. Cart widgets go near the checkout button. That works on most themes without any setup.",
      },
      { type: "h2", text: "Move a widget with the App widget block" },
      {
        type: "steps",
        items: [
          "In the app, open **Widget placement** and press **Edit product page** (or **Edit cart page**).",
          "In the theme editor, click **Add block** in the section where you want the widget, and pick **App widget** under Apps.",
          "Choose the **Widget**, for example Trust badges, Countdown timer or Delivery date.",
          "Drag the block where you want it and press **Save**.",
        ],
      },
      {
        type: "p",
        text: "When a widget has a block on the page, it shows there instead of its automatic spot. The App widget block can hold: trust badges, payment logos, countdown timer, low stock message, delivery date, size chart button, volume discount table, bundle box, buy X get Y offer, share buttons, related products and recently viewed.",
      },
      { type: "h2", text: "Reviews, star rating and FAQ blocks" },
      {
        type: "p",
        text: "On product pages you can also add the **Product reviews**, **Star rating** and **AI FAQ** blocks, and the **Store reviews** block anywhere, such as your home page. See [Managing reviews](/help/managing-reviews).",
      },
      { type: "h2", text: "Advanced: custom position" },
      {
        type: "p",
        text: "Only needed if your theme is unusual and widgets show in the wrong place. In **Widget placement**, under **Advanced: custom position**, enter a CSS selector from your theme, like `.product-form`, and choose whether widgets go before or after it. Leave it empty to let the app decide.",
      },
      {
        type: "note",
        text: "Not sure what to enter? Email us with your store address and the widget you want to move, and we'll tell you the selector.",
      },
    ],
    related: ["app-embed", "theme-sections", "troubleshooting"],
  },

  {
    slug: "theme-sections",
    title: "Page sections for your theme",
    description:
      "Nineteen ready-made sections, like a hero banner, testimonials and an FAQ, that you add to any page from the theme editor.",
    body: [
      {
        type: "p",
        text: "Besides its tools, the app adds 19 sections you can use to build pages in the theme editor. They are plain HTML and CSS with no JavaScript, so they don't slow your store down, and they're included in both plans.",
      },
      { type: "h2", text: "Add a section" },
      {
        type: "steps",
        items: [
          "Open **Online Store > Themes > Customize** and go to the page you want to change.",
          "Click **Add section**, open the **Apps** tab and pick a section.",
          "Choose its **Layout**, fill in the text and images, and set the colors and spacing.",
          "Press **Save**.",
        ],
      },
      { type: "h2", text: "The sections" },
      {
        type: "list",
        items: [
          "**Hero banner**: a big image with a heading and buttons.",
          "**Image with text**, **Rich text** and **Promo banner** for stories and offers.",
          "**Featured product**, **Featured collection** and **Collection list** to show what you sell.",
          "**Testimonials**, **Logo list** and **Numbers** to build trust.",
          "**Icon features**, **How it works** and **Comparison table** to explain your product.",
          "**FAQ**, **Newsletter signup** and **Video**.",
          "**Image gallery**, **Scrolling text** and **Divider** for layout.",
        ],
      },
      {
        type: "p",
        text: "Most sections have several layouts, 42 in all. The newsletter section uses Shopify's own sign-up form, so new subscribers go straight into your Shopify customers.",
      },
      {
        type: "note",
        text: "The Apps tab appears in the Add section menu of Online Store 2.0 themes, such as Dawn and the other free Shopify themes. Older themes may not support app sections.",
      },
    ],
    related: ["widget-placement", "app-embed"],
  },

  {
    slug: "offers",
    title: "Offers: discounts, bundles, gifts and upsells",
    description:
      "How the Offers page works: offer types, who sees an offer and when, what happens when offers overlap, A/B tests and reports.",
    body: [
      {
        type: "p",
        text: "Volume Discounts, Product Bundles, Free Gifts, Buy X Get Y and Upsell Builder all use one offer engine. You create offers on the **Offers** page, and the discount itself is calculated by Shopify at checkout through a Shopify discount function, so prices are always right.",
      },
      { type: "h2", text: "Create an offer" },
      {
        type: "steps",
        items: [
          "Turn on the tool for the offer type in **Tools**: Volume Discounts, Product Bundles, Free Gifts, Buy X Get Y or Upsell Builder.",
          "Open **Offers** and choose **New volume discount**, **New bundle**, **New free gift**, **New buy X get Y** or **New upsell**.",
          "Give it a **Name** only you see, choose the products and set the discount.",
          "Write a **Discount label**. Shoppers see it in the cart and checkout, and reports use it to count the offer's sales, so give every offer its own label.",
          "Turn on **Offer is on** and press **Save**.",
        ],
      },
      { type: "h2", text: "Who sees an offer, and when" },
      {
        type: "p",
        text: "Under **Who and when**, you can set a start and end date, a minimum cart amount, which customers (everyone, first-time buyers, returning customers or logged-in customers), customer tags and countries. Leave them empty to show the offer to everyone, all the time.",
      },
      { type: "h2", text: "When offers overlap" },
      {
        type: "p",
        text: "An item never gets two offers. Under **When offers overlap**, choose whether it gets the best deal for the shopper or the offer with the highest **Priority**.",
      },
      {
        type: "p",
        text: "Offers also combine with order discount codes and free shipping codes, but not with other product discounts.",
      },
      { type: "h2", text: "A/B tests" },
      {
        type: "p",
        text: "Shoppers are split into two equal groups, A and B. Set an offer's **A/B test group** to show it to one group only. **A/B test results** on the Offers page compare all paid orders from each group over the last 30 days; a higher average order means that group's offers work better.",
      },
      { type: "h2", text: "Reports" },
      {
        type: "p",
        text: "Each offer shows its orders, sales, average order and the discount given, from paid orders that used the offer.",
      },
      {
        type: "note",
        text: "If an offer's tool is switched off, the offer pauses and the Offers page tells you. Turn the tool back on to resume it.",
      },
    ],
    related: ["volume-discounts", "bundles", "free-gifts", "upsells"],
  },

  {
    slug: "managing-reviews",
    title: "Managing reviews",
    description:
      "Approve, reply to and import reviews, show store reviews and star ratings, and ask customers for reviews by email.",
    body: [
      {
        type: "p",
        text: "Turn on [Product Reviews](/help/product-reviews) first. Then open **Reviews** in the app to see every review, sorted into Waiting, Published and Rejected.",
      },
      { type: "h2", text: "Approve, reject and reply" },
      {
        type: "list",
        items: [
          "**Publish** shows a waiting review in your store. **Publish all on this page** does the whole page at once.",
          "**Reject** hides a review without deleting it. **Delete** removes it for good.",
          "**Reply** adds an answer that shows under the review as Store reply.",
        ],
      },
      {
        type: "p",
        text: "Which reviews are published without you depends on the tool's **Publish new reviews automatically** setting.",
      },
      { type: "h2", text: "Show stars and store reviews" },
      {
        type: "list",
        items: [
          "**Star rating** block: add it under the product title in the theme editor to show the average rating.",
          "**Store reviews** block: add it to your home page or a Reviews page to collect and show reviews about your store, not a product.",
          "Product cards: ratings are saved to Shopify's standard product rating fields, so themes with a Show product rating setting can show stars in collections.",
        ],
      },
      { type: "h2", text: "Import reviews from another app" },
      {
        type: "steps",
        items: [
          "Export your reviews as a CSV file from Judge.me, Loox, Shopify Product Reviews or another app.",
          "In **Reviews**, choose **Import reviews** and pick the file. Up to 10,000 reviews are read per file.",
          "Choose whether to **Publish imported reviews right away**, then press **Import**.",
        ],
      },
      {
        type: "p",
        text: "The file needs a rating, the review text and a product ID or handle. Name, email, title, date and reply are used when present. Reviews that are already here are skipped, and rows with problems are listed with the reason.",
      },
      { type: "h2", text: "Ask customers for reviews" },
      {
        type: "p",
        text: "On Professional, the **Review request** email in [Email Marketing](/help/email-marketing) is sent after an order is paid, with a link to review the product. Set when it goes out with **Send after**.",
      },
      { type: "h2", text: "Summaries" },
      {
        type: "p",
        text: "[AI Review Summary](/help/ai-review-summary) writes a short summary of the good and the bad above your reviews, once a product has enough of them.",
      },
    ],
    related: ["product-reviews", "ai-review-summary", "email-marketing"],
  },

  {
    slug: "analytics",
    title: "Analytics",
    description:
      "See what each tool earns and how shoppers move through your store, counted only for visitors who allow analytics.",
    body: [
      { type: "h2", text: "Results by tool" },
      {
        type: "p",
        text: "**Analytics** shows each tool's views, clicks, add to carts, orders and revenue for the last 30 days. An order counts for every tool the shopper used before buying, so the numbers show which tools take part in sales, not which one alone caused them.",
      },
      { type: "h2", text: "Store report" },
      {
        type: "p",
        text: "Below the tool results is a report of your whole store for the period you pick: visitors, page views, product views, add to carts, started checkouts, orders, revenue and conversion rate. You also see the shopper journey step by step, visitors per day, where visitors come from (including AI assistants), devices and your top pages.",
      },
      {
        type: "note",
        text: "Visitors are counted only when they allow analytics in your cookie banner, and no names, emails or addresses are collected. In regions where consent is required, your numbers are lower than Shopify's own reports for that reason.",
      },
      {
        type: "faq",
        items: [
          {
            q: "Why do I see no numbers?",
            a: "Numbers appear once shoppers visit with tools on. If the page says store analytics isn't connected, reopen the app; if that doesn't fix it, reinstall the app so Shopify can grant the analytics permission.",
          },
        ],
      },
    ],
    related: ["speed-guard", "visitor-recordings", "privacy-data"],
  },

  {
    slug: "speed-guard",
    title: "Speed Guard",
    description:
      "Measure your store's mobile speed score before and after installing, to see that the app doesn't slow your store down.",
    body: [
      {
        type: "p",
        text: "Speed Guard runs the same mobile speed test Google uses for its PageSpeed Insights report on your home page and keeps the scores, so you can compare before and after.",
      },
      {
        type: "steps",
        items: [
          "Open **Speed Guard** and press **Measure now** before you turn on any tools. This becomes your **Before the app** score.",
          "Measure again after you've set up your tools. **Now** shows the latest score, and **History** keeps every measurement.",
        ],
      },
      {
        type: "p",
        text: "A measurement usually takes under a minute, and you can leave the page while it runs.",
      },
      {
        type: "note",
        text: "Scores move a few points between runs even when nothing changed, because they depend on network and server conditions. Compare a few runs rather than one.",
      },
      {
        type: "faq",
        items: [
          {
            q: "Why does it say my store can't be measured?",
            a: "Password-protected stores can't be tested. Remove the password, or measure once your store is live.",
          },
          {
            q: "How does the app stay fast?",
            a: "One script of under 5 KB starts after your page has loaded, and it loads only the tools you switched on, each in its own file of 10 KB or less. If one tool fails, the others keep working.",
          },
        ],
      },
    ],
    related: ["getting-started", "troubleshooting"],
  },

  {
    slug: "plans-billing",
    title: "Plans and billing",
    description:
      "What's in Starter and Professional, how the free trial works, how to switch plans and what happens when you uninstall.",
    body: [
      {
        type: "list",
        items: [
          "**Starter**: {starterPrice} a month, or {starterAnnual} a year. {starterTools} tools for conversion, trust, offers, reviews and SEO.",
          "**Professional**: {proPrice} a month, or {proAnnual} a year. All {proTools} tools, including marketing, AI, live chat, instant search and visitor recordings, with {aiCredits} AI credits, {emails} emails and {recordings} visitor recordings a month.",
        ],
      },
      {
        type: "p",
        text: "Both plans start with a {trialDays}-day free trial. Prices are in US dollars and billed by Shopify on your regular invoice, before any taxes Shopify adds for your region.",
      },
      { type: "h2", text: "No usage fees" },
      {
        type: "p",
        text: "The price never goes up with use. AI credits, emails and recordings have monthly limits; when one is reached, that feature pauses until it refills next month and every other tool keeps working.",
      },
      { type: "h2", text: "Change your plan" },
      {
        type: "p",
        text: "Open **Plans** in the app and choose the other plan. Shopify asks you to approve the change and takes care of the billing.",
      },
      { type: "h2", text: "Cancel" },
      {
        type: "p",
        text: "Uninstall the app from your Shopify admin (**Settings > Apps**). Shopify cancels the subscription at once, so billing stops the moment you uninstall, and the app leaves your theme automatically.",
      },
    ],
    related: ["ai-credits", "getting-started", "privacy-data"],
  },

  {
    slug: "ai-credits",
    title: "AI credits",
    description:
      "How AI credits work on Professional: the monthly allowance, what a task costs, and what happens when credits run out.",
    body: [
      {
        type: "p",
        text: "Professional includes {aiCredits} AI credits every month ({aiTrialCredits} during the free trial). Every AI task uses credits depending on how much it reads and writes, and photo and video tasks show the cost on the form before you start.",
      },
      { type: "h2", text: "When credits run out" },
      {
        type: "p",
        text: "AI tools pause until your credits refill at the start of the next month. You are never charged extra, and every tool that isn't AI keeps working.",
      },
      { type: "h2", text: "Make credits go further" },
      {
        type: "list",
        items: [
          "Set your **Brand voice** once in AI Studio, so results need fewer retries.",
          "Write a few notes for the AI, such as materials or a sale, so the first result is closer to what you want.",
          "Videos use the most credits. Try a photo tool first, and make videos for your best products.",
        ],
      },
      {
        type: "faq",
        items: [
          {
            q: "Do unused credits roll over?",
            a: "No. The allowance refills to {aiCredits} at the start of each month.",
          },
          {
            q: "Is anything AI-made saved without my say?",
            a: "Most results wait for you to check them and press save. Summaries from AI Review Summary show right away when you write them, and you can edit or undo each one.",
          },
        ],
      },
    ],
    related: ["plans-billing", "ai-descriptions", "ai-photoshoots"],
  },

  {
    slug: "email-sending",
    title: "Email sending and email tools",
    description:
      "How the app sends email, how to set your sender details, and how to connect Klaviyo, Mailchimp or Omnisend.",
    body: [
      {
        type: "p",
        text: "On Professional, the app sends your campaigns, automatic emails, back-in-stock alerts and other messages itself, up to {emails} emails a month. You don't need another email app, but you can connect one.",
      },
      { type: "h2", text: "Set your sender details" },
      {
        type: "steps",
        items: [
          "Open **Marketing** and find **Sender details**.",
          "Set the **Sender name** shoppers see. Empty uses your store name.",
          "Set a **Reply-to email**. Replies from shoppers go there, and it also receives alerts for live chat and withdrawal requests.",
          "Add your **Business address**. Many countries require it at the bottom of marketing emails.",
          "Press **Save sender details**.",
        ],
      },
      {
        type: "p",
        text: "The Marketing page also shows how many emails you've sent this month and your delivery rate over the last 30 days.",
      },
      { type: "h2", text: "Connect Klaviyo, Mailchimp or Omnisend" },
      {
        type: "steps",
        items: [
          "Open **Integrations** in the app.",
          "Paste the API key. In Klaviyo: Settings, then API keys, with a private key that has full access to Lists, Profiles, Subscriptions and Events. In Mailchimp: Profile, then Extras, then API keys. In Omnisend: Store settings, then API keys.",
          "Press **Connect**, choose a **Default list**, and optionally a different list for each sign-up source.",
          "Press **Send all subscribers now** to send the subscribers you already have.",
        ],
      },
      {
        type: "p",
        text: "New subscribers and events are sent to connected tools from then on, and unsubscribes are synced both ways through Shopify. Integrations work on both plans.",
      },
    ],
    related: ["email-marketing", "back-in-stock", "privacy-data"],
  },

  {
    slug: "ai-assistants",
    title: "Connect ChatGPT, Claude, Gemini or Grok",
    description:
      "Give your AI assistant a private address for your store. It can read your reports and ask for changes, and nothing changes until you approve it.",
    body: [
      {
        type: "p",
        text: "On Professional, AI assistants that support remote MCP servers can connect to your store. They can read sales and visitor numbers, tools, offers, reviews (without shoppers' emails), AI search visibility and email stats, and ask to turn tools and offers on or off or to publish, hide or answer reviews. Shoppers' emails and full names are never shared.",
      },
      { type: "h2", text: "Connect" },
      {
        type: "steps",
        items: [
          "Open **AI assistants** in the app and copy **Your store's assistant address**.",
          "In ChatGPT, open Plugins, choose the add button, then Add custom MCP server; paste the address and choose OAuth. In Claude, open Settings, then Connectors, and add a custom connector with the address. In Grok, open Connectors, choose New Connector, then Custom.",
          "Your assistant opens your Shopify admin. Check who is asking and choose **Allow**.",
        ],
      },
      {
        type: "p",
        text: "For Gemini CLI, run `gemini mcp add --transport http` with a name and your address, then sign in when it asks. Assistants that can't sign in, like the xAI API or your own scripts, can use an access key: create one under **Access keys** and send it as `Authorization: Bearer YOUR_KEY`.",
      },
      { type: "h2", text: "Approve changes" },
      {
        type: "p",
        text: "Every change an assistant asks for waits on the AI assistants page until you choose **Approve** or **Reject**. Requests expire after 7 days. **Connected assistants** lists who has access, and **Disconnect** stops one at once.",
      },
      {
        type: "note",
        text: "Only allow a connection you started from your assistant just now. Anyone with an access key can read your store's reports, so keep keys secret.",
      },
    ],
    related: ["ai-visibility", "analytics", "privacy-data"],
  },

  {
    slug: "ai-visibility",
    title: "AI visibility",
    description:
      "A score for how easily Google and AI assistants can read your store and recommend your products, with a fix for each check.",
    body: [
      {
        type: "p",
        text: "Open **AI visibility** in the app (or press **Check your AI visibility** on the AI SEO Schema tool). The score is based on your 50 most recently updated products, and anything that couldn't be checked doesn't lower it.",
      },
      { type: "h2", text: "What's checked" },
      {
        type: "list",
        items: [
          "**Product data for search engines**: whether [AI SEO Schema](/help/ai-seo-schema) is on and its data shows on a live product page.",
          "**AI assistants can visit your store**: whether your robots.txt lets AI search crawlers in.",
          "**Product descriptions**: how many products have a full description.",
          "**Image alt text** and **Search titles and descriptions**.",
          "**Reviews** and **Questions and answers** on product pages.",
          "**Home page description**.",
        ],
      },
      {
        type: "p",
        text: "Each check that isn't done has a button that takes you to the fix, such as Fill in alt text or Write FAQs.",
      },
      { type: "h2", text: "AI crawlers" },
      {
        type: "p",
        text: "The page lists the crawlers AI companies send to read websites, what each is used for, and whether your robots.txt lets it in. Crawlers that collect pages to train AI models are shown separately: blocking them is up to you and doesn't change your score.",
      },
      {
        type: "p",
        text: "To let a blocked crawler in, open **Online Store > Themes > Edit code**, find the robots.txt.liquid template and remove the rule for that crawler.",
      },
      { type: "h2", text: "Files for AI assistants" },
      {
        type: "p",
        text: "Shopify publishes files like /llms.txt for your store automatically. They tell AI assistants what your store is and how to browse and buy from it, and they stay up to date by themselves.",
      },
    ],
    related: ["ai-seo-schema", "ai-product-faq", "seo-meta-templates"],
  },

  {
    slug: "privacy-data",
    title: "Privacy and your customers' data",
    description:
      "What the app stores, how consent works, how to answer a customer's data request, and what happens to data when you uninstall.",
    body: [
      { type: "h2", text: "Consent" },
      {
        type: "p",
        text: "Visitor analytics and recordings run only for visitors who allow analytics in your cookie banner, and Facebook Pixels only for visitors who allow marketing. The app follows the choice stored by Shopify, whether it came from Shopify's banner or [Cookies Banner](/help/cookies-banner).",
      },
      { type: "h2", text: "What is stored" },
      {
        type: "list",
        items: [
          "Visitor analytics are counted without names, emails or addresses.",
          "Recordings never include what shoppers type, and are deleted after 30 days.",
          "Live chats are deleted after 180 days without new messages.",
          "Photos and videos made in AI Studio are kept for 30 days. Anything you added to a product stays in your store.",
          "Subscribers, reviews, back-in-stock requests, wheel spins and withdrawal requests are kept while you use the app.",
        ],
      },
      { type: "h2", text: "Customer data requests" },
      {
        type: "p",
        text: "When a customer asks what data you hold about them, open **Marketing > View subscribers**, enter their email under **Customer data requests**, and download everything the app has stored for them. When Shopify tells the app to erase a customer, their data is deleted automatically.",
      },
      { type: "h2", text: "When you uninstall" },
      {
        type: "p",
        text: "Shopify asks the app to erase your store's data 48 hours after you uninstall, and the app does so. Reviews photos are in your own Shopify Files and stay there.",
      },
      {
        type: "note",
        text: "Read our [Privacy Policy](/privacy) for the full details, including the services we use to run the app.",
      },
    ],
    related: ["cookies-banner", "analytics", "visitor-recordings"],
  },

  {
    slug: "languages",
    title: "Languages",
    description:
      "Which parts of the app you can write in any language, and which built-in words are in English today.",
    body: [
      {
        type: "p",
        text: "Almost everything shoppers see comes from the texts you type in each tool's settings, like messages, headings and button texts. Write them in your store's language and that's what shoppers see.",
      },
      {
        type: "p",
        text: "AI tools write in the language you set under **Brand voice** in AI Studio, for example English, Bangla or Spanish.",
      },
      {
        type: "note",
        text: "A few built-in words in the store, such as Add to cart and Sold out on the sticky bar and the labels of the review form, are in English today, and so is the app itself. Other languages can be added; email us to tell us which one you need.",
      },
    ],
    related: ["currency-converter", "geolocation-redirect"],
  },

  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    description:
      "What to check when a tool doesn't show, shows twice, shows in the wrong place, or an offer or email doesn't work.",
    body: [
      { type: "h2", text: "A tool doesn't show in my store" },
      {
        type: "list",
        items: [
          "Check that **App tools** is on under App embeds in your live theme. See [The app embed](/help/app-embed).",
          "Open the tool and check that **Enabled** is on and you pressed **Save**.",
          "Professional tools only work on the Professional plan.",
          "Check where the tool shows. Many tools only appear on product pages or in the cart, and some have **Show on mobile** turned off.",
          "Some tools wait for a reason to show: Countdown Timer needs an end date, Stock Scarcity needs low tracked stock, and Recent Sales needs real orders.",
          "Reload the page. Browsers sometimes keep an old copy for a few minutes.",
        ],
      },
      { type: "h2", text: "Something shows twice" },
      {
        type: "p",
        text: "Your theme or another app probably does the same job, for example an announcement bar, payment icons, sale badges or reviews. Turn off one of them. Tools that have a Shopify version, like Currency Converter, warn you about it.",
      },
      { type: "h2", text: "A widget is in the wrong place" },
      {
        type: "p",
        text: "Place the App widget block where you want it, or set a custom position. See [Where widgets appear](/help/widget-placement).",
      },
      { type: "h2", text: "The app says two tools conflict" },
      {
        type: "p",
        text: "Some tools can't run together because they would do the same thing in the same place, like Live Chat and Chat Button. Turn one of them off.",
      },
      { type: "h2", text: "An offer isn't applied" },
      {
        type: "list",
        items: [
          "Check that the offer's tool is on and the offer is set to **Offer is on**.",
          "Check the offer's dates, minimum cart amount, customers, tags and countries.",
          "An item never gets two offers or another product discount at the same time. See [Offers](/help/offers).",
        ],
      },
      { type: "h2", text: "Emails aren't sent" },
      {
        type: "list",
        items: [
          "Check that Email Marketing is on and the automatic email has **Send this email** on.",
          "Check this month's email count on the Marketing page. Emails over the limit are skipped.",
          "With **Send automatic emails only to subscribers** on, abandoned checkout and review request emails only go to subscribers.",
        ],
      },
      {
        type: "note",
        text: "Still stuck? Email us with your store address and what you see, and we'll help.",
      },
    ],
    related: ["app-embed", "widget-placement", "offers"],
  },
];
