import type { LegalDoc } from "../types";

/**
 * Drafts, written from what the app's code really stores and sends. They show a "draft" notice
 * until a lawyer has reviewed them and brand.legal.reviewed is set to true. When the app starts
 * storing or sending something new, update the Privacy Policy in the same change.
 */
export const privacy: LegalDoc = {
  title: "Privacy Policy",
  description:
    "What data {brand} collects about merchants, their customers and visitors to this website, who it's shared with and how long it's kept.",
  updated: "2026-11-28",
  body: [
    {
      type: "p",
      text: 'This policy explains what data {company} ("we") collects through the {brand} Shopify app and this website, why, who we share it with and how long we keep it. If anything is unclear, email [{privacyEmail}](mailto:{privacyEmail}).',
    },
    { type: "h2", text: "Who we are" },
    {
      type: "p",
      text: "{companyLine} runs {brand}. For data about merchants and visitors to this website, we decide how it's used, which makes us the controller. For data about a store's customers, the store decides, and we process it only to run the tools the store turned on, which makes us its processor.",
    },
    { type: "h2", text: "Data about merchants" },
    {
      type: "list",
      items: [
        "**Your store**: its Shopify address, the access Shopify grants the app, your plan and trial dates.",
        "**What you set up**: tool settings, offers, email campaigns and sender details, AI brand settings, and the results of AI tools you run.",
        "**Billing**: Shopify bills you and handles payment. We only learn which plan you're on, never your payment details.",
        "**AI assistants you connect**: which ones have access, and the changes they asked for.",
        "**Support**: messages you send us.",
      ],
    },
    { type: "h2", text: "Data about your store's customers" },
    {
      type: "p",
      text: "Each tool handles only the data it needs, and only once you turn it on:",
    },
    {
      type: "table",
      headers: ["Tool", "Data", "Kept for"],
      rows: [
        [
          "Visitor analytics",
          "Page views, carts, checkouts and orders, counted per day. Each visitor gets a scrambled code so they're counted once a day. No names, emails or addresses.",
          "Codes 2 days; daily totals while the app is installed",
        ],
        [
          "Visitor Recordings",
          "Mouse movement, clicks, scrolling and the page's layout. Text typed into fields is never recorded.",
          "30 days",
        ],
        [
          "Email marketing, pop-ups and Spin Wheel",
          "Subscribers' email addresses, first names, consent and order dates",
          "While the app is installed",
        ],
        [
          "Spin Wheel",
          "The email address, prize and discount code of each spin, so each shopper spins only as often as the store allows",
          "1 year",
        ],
        [
          "Abandoned checkout emails",
          "Email address, first name and cart of checkouts that weren't finished",
          "30 days",
        ],
        [
          "Emails sent",
          "Who each email went to, and whether it was delivered, opened or clicked",
          "180 days",
        ],
        [
          "Product Reviews",
          "Reviewers' names, reviews, ratings, photos and, if given, email addresses",
          "While the app is installed; photos are stored in your Shopify Files",
        ],
        [
          "Back in Stock",
          "The email address and product of each stock alert",
          "30 days after the shopper is emailed; a year at most if the product never comes back",
        ],
        [
          "Wishlist",
          "The products on each wishlist, saved under the customer's account or a random code",
          "While the app is installed",
        ],
        [
          "Order Tracker",
          "The order number and the email address or phone number a shopper types, checked against that order in Shopify. Only the order's status, items and tracking are shown.",
          "Not kept by us",
        ],
        [
          "Live Chat",
          "Messages, the page they were sent from and, if the shopper gives one, an email address for replies",
          "180 days after the last message",
        ],
        [
          "Push Notifications",
          "The address a browser's push service gives for sending it notifications",
          "Until the browser stops accepting them",
        ],
        [
          "EU Withdrawal Button",
          "Name, email address and order number in each withdrawal request",
          "While the app is installed",
        ],
        [
          "Facebook Pixels",
          "Page views, product views, carts and purchases, sent from the shopper's browser straight to Meta with Meta's cookies. Never names, emails, phone numbers or addresses.",
          "Not kept by us",
        ],
      ],
    },
    {
      type: "p",
      text: "Visitor analytics and recordings only run for shoppers who allow analytics, and Facebook Pixels only for shoppers who allow marketing, following the choice Shopify stores for each shopper.",
    },
    {
      type: "p",
      text: "Stores using {brand} tell their customers about it in their own privacy policy and answer their customers' requests. The app helps: it downloads everything stored about an email address, and erases a customer's data automatically when Shopify asks. See [Privacy and your customers' data](/help/privacy-data).",
    },
    { type: "h2", text: "Data about visitors to this website" },
    {
      type: "list",
      items: [
        "**Page analytics**: when turned on, PostHog counts page views without cookies or browser storage, ignores browsers that send Do Not Track and never records sessions. It receives your IP address and browser details with each page view.",
        "**Support assistant**: questions you type are sent to Anthropic to write an answer from our help center. We don't keep the conversation. Your IP address is used for a short time to limit how many questions can be sent.",
        "**Email**: messages you send us.",
      ],
    },
    { type: "h2", text: "AI features" },
    {
      type: "p",
      text: "AI tools send what they work on to our AI providers: product details and photos, review texts, page content or instructions you type. Anthropic doesn't train its models on data sent through its business API. AI output can be wrong, so check it before you publish it.",
    },
    { type: "h2", text: "Who we share data with" },
    {
      type: "p",
      text: "We don't sell personal data or share it for advertising. These services help us run {brand}, each only for its own job:",
    },
    {
      type: "table",
      headers: ["Service", "What it does", "Data it receives"],
      rows: [
        [
          "Shopify",
          "The platform the app runs on, and billing",
          "What the app reads from and writes to your store",
        ],
        [
          "Our hosting provider",
          "Runs the app's servers and database",
          "Everything the app stores",
        ],
        ["Cloudflare R2", "File storage", "Recordings, and photos and videos made with AI tools"],
        [
          "Anthropic",
          "AI writing and image understanding",
          "Content sent to AI tools and to this website's support assistant",
        ],
        ["fal.ai", "AI photo and video tools", "Product photos and your instructions"],
        [
          "Resend or Amazon Web Services",
          "Sends emails",
          "Recipients' email addresses and the emails",
        ],
        [
          "Browser push services from Google, Apple, Mozilla and Microsoft",
          "Deliver push notifications",
          "Push addresses and notification text",
        ],
        ["Google PageSpeed Insights", "Speed Guard tests", "Your store's web address"],
        [
          "PostHog",
          "Page analytics on this website",
          "Page views, IP addresses and browser details",
        ],
        [
          "Klaviyo, Mailchimp or Omnisend",
          "Only if you connect one: receives your new subscribers",
          "Subscribers' email addresses, names and consent",
        ],
        [
          "Meta",
          "Only if you turn on Facebook Pixels",
          "Store events from shoppers who allow marketing",
        ],
      ],
    },
    {
      type: "p",
      text: "We also share data when the law requires it, and if {company} is ever sold, this policy goes with the data.",
    },
    { type: "h2", text: "Where data is processed" },
    {
      type: "p",
      text: "Our providers work in the United States and other countries. When personal data leaves the European Economic Area, the UK or Switzerland, we use the safeguards the law requires, such as the European Commission's Standard Contractual Clauses.",
    },
    { type: "h2", text: "How long we keep data" },
    {
      type: "list",
      items: [
        "Recordings, and photos and videos made with AI tools: 30 days.",
        "Abandoned checkouts: 30 days. Live chats: 180 days after the last message. The log of emails sent: 180 days.",
        "Stock alerts: 30 days after the shopper is emailed, and a year at most while waiting. Spin Wheel spins: 1 year.",
        "Scrambled visitor codes for analytics: 2 days.",
        "Everything else: while the app is installed. 48 hours after you uninstall, Shopify asks us to erase your store's data, and we do.",
      ],
    },
    { type: "h2", text: "Security" },
    {
      type: "p",
      text: "Data is encrypted on its way over the internet, our backups are encrypted, and keys for services you connect are stored encrypted. Only the people who need access to run the service have it.",
    },
    { type: "h2", text: "Your rights" },
    {
      type: "p",
      text: "Depending on where you live, you can ask to see, correct, delete or download your data, object to or limit how we use it, and withdraw consent. Email [{privacyEmail}](mailto:{privacyEmail}) and we'll answer within a month. You can also complain to your data protection authority.",
    },
    {
      type: "p",
      text: "If you shop at a store that uses {brand}, contact the store: it decides how your data is used, and we'll help it answer you.",
    },
    { type: "h2", text: "Children" },
    {
      type: "p",
      text: "{brand} is a tool for businesses. This website isn't meant for children, and we don't knowingly collect data from them.",
    },
    { type: "h2", text: "Changes to this policy" },
    {
      type: "p",
      text: "When we change this policy, we update the date at the top. When a change matters, we tell merchants in the app or by email before it takes effect.",
    },
    { type: "h2", text: "Contact" },
    {
      type: "p",
      text: "{companyLine}. Privacy questions: [{privacyEmail}](mailto:{privacyEmail}). Anything else: [{supportEmail}](mailto:{supportEmail}).",
    },
  ],
};

/** Used for `{governingLaw}` until brand.legal.governingLaw is set */
export const governingLawFallback = "the country where {company} is established";

export const terms: LegalDoc = {
  title: "Terms of Service",
  description:
    "The agreement between {company} and the merchants who use {brand}: plans and billing, fair use, AI features, data and liability.",
  updated: "2026-11-16",
  body: [
    {
      type: "p",
      text: 'These terms are the agreement between you, the merchant, and {company} ("we") for using the {brand} Shopify app. By installing or using it, you accept them. If you accept them for a business, you confirm that you\'re allowed to.',
    },
    { type: "h2", text: "1. The service" },
    {
      type: "p",
      text: "{brand} is an app for Shopify stores with tools for conversion, trust, offers, reviews, marketing, SEO and AI. You need an active Shopify store, and Shopify's own terms apply to your use of Shopify.",
    },
    { type: "h2", text: "2. Plans, trial and billing" },
    {
      type: "list",
      items: [
        "**Starter** costs {starterPrice} a month or {starterAnnual} a year. **Professional** costs {proPrice} a month or {proAnnual} a year. Prices are in US dollars, before any taxes Shopify adds.",
        "Both plans start with a {trialDays}-day free trial. You're only charged if the app is still installed when the trial ends.",
        "Shopify bills you on your regular Shopify invoice. We never see your payment details.",
        "There are no usage fees. AI credits, emails and recordings have monthly limits; when one is reached, that feature pauses until the next month instead of costing more. Unused allowances don't carry over and have no cash value.",
        "You can switch plans in the app at any time. We'll tell you at least 30 days before a price increase, and it only applies once you approve it in Shopify.",
      ],
    },
    { type: "h2", text: "3. Cancelling" },
    {
      type: "p",
      text: "Uninstall the app to cancel. Shopify ends the subscription at once, and you won't be charged again. Charges for a billing period that has already started aren't refunded unless the law requires it.",
    },
    { type: "h2", text: "4. Fair use" },
    { type: "p", text: "You agree not to use {brand} to:" },
    {
      type: "list",
      items: [
        "mislead shoppers, for example with fake reviews, invented sales or deadlines that aren't real;",
        "send emails or notifications to people who haven't agreed to receive them;",
        "break the law, including consumer protection, privacy and intellectual property law;",
        "create AI content that infringes someone's rights or that is illegal, hateful or sexually explicit;",
        "copy, resell or reverse-engineer the app, get around its limits, or put an unreasonable load on it.",
      ],
    },
    {
      type: "p",
      text: "If you break these rules, we may suspend tools or your access, warning you first where we reasonably can.",
    },
    { type: "h2", text: "5. Your content and your customers' data" },
    {
      type: "p",
      text: "You own what you add to the app and, as far as the law allows, what it creates for you, including AI output. You allow us to store and process it only to run the app for you.",
    },
    {
      type: "p",
      text: "You decide which tools collect data about your customers. You're responsible for having a legal basis for that, telling your customers in your store's privacy policy, and getting consent where the law requires it, such as for analytics cookies and marketing emails. We process that data on your behalf as our [Privacy Policy](/privacy) describes. If you need a data processing agreement, email [{privacyEmail}](mailto:{privacyEmail}).",
    },
    { type: "h2", text: "6. AI features" },
    {
      type: "p",
      text: "AI tools can make mistakes. Check AI-written text, photos and videos before you publish them, especially facts, prices and claims about your products.",
    },
    { type: "h2", text: "7. Other services" },
    {
      type: "p",
      text: "Some tools work with other services you choose to connect, like Klaviyo, Mailchimp, Omnisend, Meta or an AI assistant. Their own terms apply to them, and we aren't responsible for how they work.",
    },
    { type: "h2", text: "8. Availability and changes" },
    {
      type: "p",
      text: "We work to keep {brand} running and fast, but we can't promise it will always be available or free of errors. We may improve, change or remove tools, and we'll tell you ahead of time before we remove a tool you use.",
    },
    { type: "h2", text: "9. Our rights" },
    {
      type: "p",
      text: "The app and this website, including their code, designs and texts, belong to {company}. If you send us ideas or feedback, we may use them without owing you anything.",
    },
    { type: "h2", text: "10. Liability" },
    {
      type: "p",
      text: "The app is provided as it is. As far as the law allows, we give no promises beyond those in these terms, we aren't liable for indirect losses such as lost profits, sales or data, and our total liability for all claims is limited to what you paid us in the 12 months before the claim. Nothing in these terms limits liability that the law doesn't allow us to limit.",
    },
    {
      type: "p",
      text: "If someone makes a claim against us because of your content or your breach of these terms, you'll cover our reasonable costs.",
    },
    { type: "h2", text: "11. Ending the agreement" },
    {
      type: "p",
      text: "You can stop at any time by uninstalling the app. We can end this agreement with 30 days' notice, or at once if you seriously break these terms. After the app is uninstalled, your data is erased as our Privacy Policy describes.",
    },
    { type: "h2", text: "12. Law and disputes" },
    {
      type: "p",
      text: "These terms are governed by the laws of {governingLaw}. If a dispute comes up, we'll both try to settle it by talking first.",
    },
    { type: "h2", text: "13. Changes to these terms" },
    {
      type: "p",
      text: "We'll tell you, in the app or by email, at least 30 days before a change that matters takes effect. If you keep using the app after that, the new terms apply.",
    },
    { type: "h2", text: "Contact" },
    {
      type: "p",
      text: "{companyLine}. Email [{supportEmail}](mailto:{supportEmail}).",
    },
  ],
};
