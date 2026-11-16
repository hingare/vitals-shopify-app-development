import type { Post } from "../../types";

/**
 * Blog posts. Every claim about laws, Shopify or other companies is one we checked against the
 * source; anything about this app must match what the app really does.
 */
export const posts: Post[] = [
  {
    slug: "fake-urgency-and-fake-reviews",
    title: "Fake countdowns, fake stock and fake reviews: the rules and the honest alternatives",
    description:
      "Timers that restart, invented low-stock warnings and made-up reviews are banned in the EU, the UK and the US. What the rules say, and honest versions that still help shoppers decide.",
    published: "2026-11-16",
    updated: "2026-11-16",
    body: [
      {
        type: "p",
        text: "A countdown that starts again when the page reloads. \"Only 2 left\" on a product with 200 in stock. A pop-up saying someone just bought this when nobody did. Reviews copied from a supplier's page. Tricks like these take a minute to install, and in the biggest markets Shopify stores sell to, they are now plainly against the law.",
      },
      {
        type: "note",
        text: "This article is general information, not legal advice. Rules differ by country and change over time, so check with a lawyer about your own store.",
      },
      { type: "h2", text: "What the rules say" },
      {
        type: "table",
        headers: ["Where", "Rule", "What it bans"],
        rows: [
          [
            "European Union",
            "Unfair Commercial Practices Directive, Annex I",
            "Point 7: falsely saying a product or a deal is only available for a very limited time to push a quick decision. Points 23b and 23c, in force since May 2022: saying reviews come from real buyers without reasonable checks, and posting, buying or misrepresenting fake reviews.",
          ],
          [
            "United Kingdom",
            "Digital Markets, Competition and Consumers Act 2024",
            "A list of practices that are always unfair, including false limited-time claims and fake reviews. Since April 2025, the Competition and Markets Authority can fine a business directly, up to 10% of its global turnover.",
          ],
          [
            "United States",
            "FTC rule on consumer reviews and testimonials (16 CFR Part 465)",
            "In force since October 21, 2024: fake reviews and testimonials, paying for reviews that must be positive or negative, and hiding negative reviews while presenting the rest as all your reviews. Knowing violations can bring civil penalties for each one.",
          ],
        ],
      },
      {
        type: "p",
        text: "Countdowns and stock messages are covered in the US too. In its 2022 staff report on dark patterns, the FTC lists baseless countdown timers and false low-stock messages among its examples of deceptive design, and deceptive practices are illegal under the FTC Act.",
      },
      { type: "h2", text: "Why fake urgency backfires" },
      {
        type: "p",
        text: "It's easy to catch. Reload the page and the timer starts over. Open it on a phone and it says something different. Come back next week and the last-chance sale is still running. A shopper who catches one trick has no reason to believe the rest of the page, including your real prices, real reviews and real stock.",
      },
      { type: "h2", text: "Honest versions that still help shoppers decide" },
      {
        type: "list",
        items: [
          "**A countdown to a real deadline.** The sale really ends then, every visitor sees the same clock, and it disappears when time is up. End the discount at the same moment.",
          "**Stock levels from your real inventory.** \"Only 3 left\" is useful when it's true, and it changes as your stock does.",
          "**Real recent sales.** A note that a product sold an hour ago is reassuring, as long as the sale happened. Leave out names and locations: those customers didn't agree to be shown.",
          "**Reviews from real buyers.** Ask customers for a review after their order, and bring over reviews you already collected for the same products. Don't copy reviews from a supplier's or another store's page: those people didn't buy from you.",
          "**All the genuine reviews, including the bad ones.** Holding reviews for a quick check against spam, abuse or private details is fine. Leaving genuine reviews unpublished because they're negative is the review suppression the FTC rule describes.",
          "**Real reasons to act now.** \"Spend $12 more for free shipping\" creates urgency from a real benefit.",
        ],
      },
      { type: "h2", text: "How {brand} handles this" },
      {
        type: "list",
        items: [
          "[Countdown Timer](/help/countdown-timer) counts down to the end date you set, shows every visitor the same time and hides itself when the sale is over. There is no option for a timer that restarts per visitor.",
          "[Stock Scarcity](/help/stock-scarcity) reads the selected variant's stock from Shopify, and only shows for products whose quantity Shopify tracks.",
          "[Recent Sales Notifications](/help/recent-sales) only shows paid orders from the last few days, without customer names or cities, and shows nothing until real orders come in.",
          "[Product Reviews](/help/product-reviews) has no way to create reviews. By default, reviews under 4 stars wait for you to check them before they appear. Check them, and publish the genuine ones.",
          "[AI Review Summary](/help/ai-review-summary) sums up what customers say, the good and the bad.",
        ],
      },
      {
        type: "faq",
        items: [
          {
            q: "Is a countdown timer allowed at all?",
            a: "Yes, when the deadline is real: the offer actually ends at that time, for everyone. What the rules ban is a deadline that isn't true.",
          },
          {
            q: "Can I keep the reviews from my old review app?",
            a: "Yes. Your own customers wrote them about your products, so moving them to a new app is fine. In {brand} you import them from a CSV file, as described in [Managing reviews](/help/managing-reviews).",
          },
          {
            q: "Can I remove a review that's abusive?",
            a: "Yes. The FTC rule allows leaving out reviews that are abusive, off-topic, contain private information or are clearly fake, as long as you apply the same rules to good and bad reviews.",
          },
        ],
      },
    ],
  },
  {
    slug: "shopify-apps-and-store-speed",
    title: "How apps slow down a Shopify store, and how to check yours",
    description:
      "What Core Web Vitals measure, where to see your store's numbers, how apps add weight, and a short audit to find the ones that cost you speed.",
    published: "2026-11-16",
    updated: "2026-11-16",
    body: [
      {
        type: "p",
        text: "Every app that shows something in your store adds code that shoppers' phones download and run. One well-built app barely registers. Ten apps that each load their own scripts, styles and fonts on every page often do, and so can code left behind by apps you removed long ago.",
      },
      { type: "h2", text: "What to measure" },
      {
        type: "p",
        text: "Google measures how a page feels to real visitors with three numbers called Core Web Vitals. It looks at the 75th percentile: a page is good when at least three out of four visits meet the target.",
      },
      {
        type: "table",
        headers: ["Measure", "What it tells you", "Good"],
        rows: [
          [
            "Largest Contentful Paint (LCP)",
            "How long until the main image or text has loaded",
            "2.5 seconds or less",
          ],
          [
            "Interaction to Next Paint (INP)",
            "How quickly the page reacts to taps and clicks",
            "200 milliseconds or less",
          ],
          [
            "Cumulative Layout Shift (CLS)",
            "How much the page jumps around while it loads",
            "0.1 or less",
          ],
        ],
      },
      { type: "h2", text: "Where to find your numbers" },
      {
        type: "list",
        items: [
          "**Shopify's web performance dashboard**, in your Shopify admin, shows these three numbers from real visits to your store, by page type and device. Start here: it's what your shoppers actually experience.",
          "**PageSpeed Insights** from Google tests one page and explains what slowed it down. Test a product page and a collection page, not only your home page: when Shopify measures an app's effect on speed for its App Store, product and collection pages make up more than 80% of the score.",
          "**[Speed Guard](/help/speed-guard)** in {brand} runs the same mobile test on your home page and keeps a history, so you can compare before and after a change.",
        ],
      },
      {
        type: "p",
        text: "Test scores move a few points between runs even when nothing changed. Run each test three times and compare the middle result.",
      },
      { type: "h2", text: "How apps add weight" },
      {
        type: "list",
        items: [
          "**Code on every page.** Many apps load their scripts on every page, even pages where they show nothing.",
          "**The same code more than once.** Three apps that each bring their own slider, pop-up or icon library make phones download similar code three times.",
          "**Widgets that arrive late.** A bar or banner that appears after the page has loaded pushes everything down. That's layout shift, and it's how shoppers end up tapping the wrong thing.",
          "**Leftovers from old apps.** Before theme app extensions, apps often edited your theme files, and uninstalling them didn't undo the edits. Shopify calls this ghost code, and it can still load today.",
        ],
      },
      { type: "h2", text: "A short app audit" },
      {
        type: "steps",
        items: [
          "Write down your numbers from the web performance dashboard, and run PageSpeed Insights three times each on your home page, a product page and a collection page.",
          "In your Shopify admin, open **Settings > Apps** and go through the list. For each app, ask whether you used it last month and whether another app already does the same job.",
          "Duplicate your live theme in **Online Store > Themes**, so you have a copy to go back to.",
          "Uninstall the apps you don't need. Apps built with theme app extensions take their code with them.",
          "For apps you removed in the past, open **Edit code** on your theme and look through `layout/theme.liquid` and the snippets folder for code that mentions them. If you find code you didn't write, ask the app's developer or a Shopify developer before deleting it.",
          "Run the same tests on the same pages again, and keep the change if the numbers improved.",
        ],
      },
      { type: "h2", text: "How {brand} keeps its weight down" },
      {
        type: "list",
        items: [
          "One loader of under 5 KB starts after your page has loaded, then fetches only the tools you switched on, each in its own file of 10 KB or less.",
          "It adds itself to your theme only through Shopify's app embed and app blocks, so uninstalling removes it completely.",
          "Shopify requires apps in its App Store not to lower a store's speed score by more than 10 points. Check us against that yourself with [Speed Guard](/help/speed-guard) before and after you turn tools on.",
        ],
      },
      {
        type: "note",
        text: "Replacing several apps with one only helps if the one is light. Whatever you install, measure before and after.",
      },
    ],
  },
  {
    slug: "get-found-by-ai-assistants",
    title: "Getting your store found by ChatGPT, Claude and other AI assistants",
    description:
      "What AI assistants read when they suggest products, which crawlers to let in, and the product details that make your store easy to recommend.",
    published: "2026-11-16",
    updated: "2026-11-16",
    body: [
      {
        type: "p",
        text: "More shoppers now ask an AI assistant what to buy before they search or browse. The assistant answers from what it can read: product pages, prices, reviews and policies. Nobody can promise that an assistant will recommend your store, but you can make sure it can read your store and finds clear facts when it does.",
      },
      { type: "h2", text: "Let AI search crawlers in" },
      {
        type: "p",
        text: "AI companies send different crawlers for different jobs, and your robots.txt file decides which ones may visit. Blocking one kind doesn't block the others.",
      },
      {
        type: "table",
        headers: ["Kind", "Examples", "What it does"],
        rows: [
          [
            "Search",
            "OAI-SearchBot (ChatGPT), Claude-SearchBot, PerplexityBot, Googlebot, Bingbot",
            "Reads pages so they can appear and be linked in answers. Keep these allowed.",
          ],
          [
            "On request",
            "ChatGPT-User, Claude-User, Perplexity-User",
            "Opens a page when someone asks the assistant about it.",
          ],
          [
            "Training",
            "GPTBot, ClaudeBot, CCBot",
            "Collects pages to train future AI models. Blocking these is up to you, and for OpenAI and Anthropic it doesn't remove you from their search answers.",
          ],
        ],
      },
      {
        type: "p",
        text: "Google works differently. AI Overviews are part of Google Search, so they use Googlebot. Google-Extended isn't a separate crawler but a setting for whether Google may use your pages for its Gemini models, and it doesn't affect Google Search.",
      },
      {
        type: "p",
        text: "Shopify creates your robots.txt file for you. To change it, edit the robots.txt.liquid template under **Online Store > Themes > Edit code**, or add it there if your theme doesn't have one.",
      },
      { type: "h2", text: "Write product pages that answer questions" },
      {
        type: "list",
        items: [
          "**Specific descriptions.** Materials, sizes and fit, who it's for, how to care for it and what's in the box. An assistant asked for \"a waterproof hiking jacket under $150\" can only match facts you wrote down.",
          "**Answers to common questions** on the product page, like sizing, compatibility and delivery times.",
          "**Alt text on images** that says what each photo shows.",
          "**Search titles and descriptions** for products and collections, written for people.",
          "**Clear policies.** Shipping costs, delivery times and returns, on pages that are easy to find.",
        ],
      },
      { type: "h2", text: "Add structured data" },
      {
        type: "p",
        text: "Structured data is a summary of a page in a format machines read without guessing: the product's name, price and currency, whether it's in stock, the brand, and the rating when there are real reviews. Many themes include some of it. Check a product page with Google's Rich Results Test to see what yours has.",
      },
      {
        type: "note",
        text: "Only describe what shoppers can see on the page. A rating in the structured data that doesn't match the reviews on the page can count against you.",
      },
      { type: "h2", text: "Collect real reviews" },
      {
        type: "p",
        text: "Assistants often sum up what customers say about a product. A steady flow of genuine reviews, including a few critical ones you've answered, gives them more to go on than a handful of five-star ratings.",
      },
      { type: "h2", text: "Shopify's files for AI agents" },
      {
        type: "p",
        text: "Shopify publishes a file for AI agents at /agents.md on every store, and /llms.txt and /llms-full.txt show the same content. It tells agents what your store is and how to browse and buy from it, and Shopify keeps it up to date, so most stores never need to touch it.",
      },
      { type: "h2", text: "How {brand} helps" },
      {
        type: "list",
        items: [
          "[AI visibility](/help/ai-visibility) scores how easily search engines and AI assistants can read your store, shows which AI crawlers your robots.txt lets in, and links each gap to its fix.",
          "[AI SEO Schema](/help/ai-seo-schema) adds structured data for your products, with ratings from your real reviews.",
          "[AI Product FAQ](/help/ai-product-faq) writes questions and answers for product pages from your product details, and shows them after you check them.",
          "[AI Alt Text](/help/ai-alt-text) describes your product photos, and [SEO Meta Templates](/help/seo-meta-templates) fills in empty search titles and descriptions.",
        ],
      },
      {
        type: "p",
        text: "A good place to start: make sure your store isn't password-protected, that AI search crawlers are allowed in, and that your best sellers have full descriptions.",
      },
    ],
  },
];
