import type { ToolArticle } from "../../types";

/**
 * AI and SEO tools. Tools marked alwaysOn open in AI Studio and have no switch; the article page
 * adds the "open AI Studio" step for them instead of the settings steps.
 */
export const ai: Record<string, ToolArticle> = {
  "ai-seo-schema": {
    intro:
      "AI SEO Schema adds structured data to your store: product prices, stock and ratings, your brand and logo, and the path to each page. Google and AI assistants read this data to show your products correctly, with price, stock and stars in results.",
    setup: [
      "Keep **Product data**, **Store and brand data** and **Page path (breadcrumbs)** on.",
      "Set **Days customers have to return an item** and **Return shipping** to match your return policy, or leave the days at 0 to leave returns out.",
      "Turn on **Remove the same data if your theme already adds it** if the AI visibility page reports duplicates.",
    ],
    after: [
      "Press **Check your AI visibility** on the tool page to confirm the data shows up on a live product page. See [AI visibility](/help/ai-visibility).",
      "You can also test any product page with Google's Rich Results Test.",
    ],
    tips: [
      "Ratings are included once [Product Reviews](/help/product-reviews) has published reviews for a product.",
    ],
    related: ["ai-visibility", "seo-meta-templates", "product-reviews"],
  },

  "seo-meta-templates": {
    intro:
      "SEO Meta Templates fills in the empty search titles and descriptions of your products and collections from patterns you set. Text you wrote yourself is never changed, and you can undo what the app filled in.",
    setup: [
      "Write the patterns for product and collection titles and descriptions. Each field lists the words you can use, like `{product}`, `{shop}` and `{description}`, which is the start of the product description.",
      "Keep **Fill in new and edited products automatically** on so new products are covered about a minute after you save them.",
    ],
    after: [
      "Press **Fill in empty fields** on the tool page, check the example, then press **Fill in empty fields** again to fill in your existing products and collections.",
      "To undo, use **Empty what this app filled in** on the same page. Fields you changed afterwards are left alone.",
    ],
    tips: [
      "Search titles over about 60 characters get cut off in Google, so keep patterns short.",
      "For descriptions written for each product, use [AI Product Descriptions](/help/ai-descriptions) with the SEO option on.",
    ],
    related: ["ai-seo-schema", "seo-alt-tags", "ai-visibility"],
  },

  "ai-alt-text": {
    intro:
      "AI Alt Text looks at each product photo and writes alt text that describes what's in it. You review the text before anything is saved, and saved text can be undone.",
    setup: [
      "Choose a product.",
      "Keep **Only photos without alt text** on to leave photos that already have alt text alone.",
      "Press **Generate**, check each text, edit it if needed, and press **Save to store**.",
    ],
    tips: [
      'Good alt text says what a shopper would see: "Blue linen shirt with short sleeves, front view", not "shirt image".',
      "For a quick fill of every image without AI, use [SEO Alt Tags](/help/seo-alt-tags).",
    ],
    related: ["seo-alt-tags", "ai-descriptions", "ai-credits"],
  },

  "ai-descriptions": {
    intro:
      "AI Product Descriptions writes product descriptions, and search titles and descriptions if you want, in your brand voice. You see a preview first and choose what to save.",
    setup: [
      "Set up your **Brand voice** in AI Studio once: how your brand sounds, who you sell to, the writing language and words to avoid. Every AI tool follows it.",
      "Choose a product and the **Length**.",
      "Turn on **Also write the SEO title and description** if you want those too.",
      "Add **Notes for the AI**, like a material, a care tip or a sale, then press **Generate**.",
      "Check the result, edit it if needed, and press **Save to store**.",
    ],
    tips: [
      "The more your product data says (materials, sizes, what's in the box), the better the description. AI only writes what it's told.",
      "If the description was edited in Shopify after you saved it, Undo leaves your newer text alone.",
    ],
    related: ["ai-alt-text", "description-tabs", "ai-credits"],
  },

  "ai-product-faq": {
    intro:
      "AI Product FAQ writes questions and answers for product pages from the product details, and shows them in your store after you check them. It also adds FAQ data that search engines and AI assistants can read.",
    setup: [
      "Change the **Heading** if you like.",
      "Keep **Add FAQ data for search engines** on.",
      "Pick **Colors**.",
    ],
    after: [
      "Press **Write FAQs with AI** on the tool page, choose a product and the **Number of questions**, and press **Generate**.",
      "Edit or remove questions, then press **Save to store**. They show on the product page right away.",
      "To place the questions elsewhere on the product page, add the **AI FAQ** block in the theme editor.",
    ],
    tips: [
      "Check every answer for facts like sizes, materials and shipping. The AI only knows what the product page says.",
    ],
    related: ["ai-visibility", "ai-seo-schema", "ai-credits"],
  },

  "ai-review-summary": {
    intro:
      "AI Review Summary writes a short summary of what customers say about a product, with the good and the bad, and shows it above your product reviews. It's updated when new reviews come in.",
    setup: [
      "Change the **Heading** if you like.",
      "Set **Reviews needed before a summary is shown**. Five is a good minimum.",
      "Keep **Update the summary when new reviews come in** on.",
    ],
    after: [
      "Open **AI Studio**, choose **AI Review Summary**, and press **Write summaries** to cover up to 50 products that have enough reviews, or pick one product.",
      "Summaries show on product pages right away. You can edit or undo each one.",
    ],
    tips: [
      "Summaries are written only from published reviews, so hidden or rejected reviews never shape them.",
    ],
    related: ["product-reviews", "managing-reviews", "ai-credits"],
  },

  "ai-background-remover": {
    intro:
      "AI Background Remover takes the background out of product photos and puts the product on clean white or a transparent background.",
    setup: [
      "Choose a product and the photos to use.",
      "Choose the **New background**: white or transparent. The form shows how many credits it uses.",
      "Press **Generate**, compare the before and after, and press **Add this one** for the results you want.",
    ],
    after: [
      "Results are added to the product as new photos. Your other photos aren't changed, and Undo removes the new one again.",
    ],
    tips: [
      "Many marketplaces and Google Shopping prefer a plain white background for the main product photo.",
    ],
    related: ["ai-photoshoots", "ai-image-enhancer", "ai-credits"],
  },

  "ai-image-enhancer": {
    intro:
      "AI Image Enhancer makes product photos sharper and larger, or extends them to a new shape, like square for marketplaces or tall for stories.",
    setup: [
      "Choose a product and a photo.",
      "Choose **What to do**: make it sharper and larger, or extend it to a new shape. For a new shape, pick the shape.",
      "Press **Generate**, compare the result, and press **Add this one** to add it to the product.",
    ],
    tips: [
      "Photos that are already large can't be enlarged further. Extend them to a new shape instead.",
    ],
    related: ["ai-background-remover", "ai-photoshoots", "ai-credits"],
  },

  "ai-photoshoots": {
    intro:
      "AI Photoshoots puts your product in new scenes, like a studio, a marble counter, a kitchen or outdoors, without a real photoshoot. The product itself is taken from your photo as it is; only the scene around it is new.",
    setup: [
      "Choose a product and a photo. A photo with a plain background works best.",
      "Pick a **Scene**, or choose Describe my own and write where the product stands and what's around it.",
      "Choose the **Number of photos** and the **Photo shape**, then press **Generate**.",
      "Press **Add this one** for each result you want on the product.",
    ],
    related: ["ai-background-remover", "ai-image-to-video", "ai-credits"],
  },

  "ai-image-to-video": {
    intro:
      "AI Image to Video turns a product photo into a short moving video for your store and social media, like a slow zoom or a camera turning around the product.",
    setup: [
      "Choose a product and a photo.",
      "Pick the **Movement**, or describe your own.",
      "Choose the **Video length**, then press **Generate**. Videos usually take 2 to 5 minutes, and you can leave the page meanwhile.",
      "Watch the whole video, then press **Add this one** to add it to the product, or download it.",
    ],
    tips: [
      "AI video can change small details, like text on a label. Always watch the full video before adding it.",
      "Generated files are kept for 30 days. Anything you added to a product stays there.",
    ],
    related: ["ai-video-ads", "ai-photoshoots", "ai-credits"],
  },

  "ai-video-ads": {
    intro:
      "AI Video Ads makes short video ads from your product photos, together with the ad text: an opening line, a headline, the main text, hashtags and a button.",
    setup: [
      "Choose a product and the photos to use.",
      "Pick the platform, the goal of the ad, the video length and the button, then press **Generate**.",
      "Watch the video, copy the ad text, and download the video for your ad account.",
    ],
    tips: [
      "Check the ad text against the rules of the platform you advertise on, especially for health or money claims.",
    ],
    related: ["ai-image-to-video", "ai-social-posts", "ai-credits"],
  },

  "ai-page-builder": {
    intro:
      "AI Page Builder writes a whole page from a short description: a landing page, About us, FAQ, size guide, shipping and returns, or your brand story. It's saved as a hidden page in your store until you publish it.",
    setup: [
      "Choose the **Page type** and describe **What the page is about**.",
      "Press **Generate**, then edit the title and sections or remove the ones you don't need.",
      "Press **Create hidden page**.",
    ],
    after: [
      "Open the page in Shopify (Online Store > Pages), check it and set it to visible. Add it to your menu under Online Store > Navigation.",
    ],
    related: ["ai-page-audit", "ai-descriptions", "ai-credits"],
  },

  "ai-product-importer": {
    intro:
      "AI Product Importer creates a draft product from a link to a product page, such as your supplier's page or another site of yours. You check everything before it goes live.",
    setup: [
      "Paste the **Product page address** (an https link) and press **Generate**.",
      "Check the title, description, brand, product type, price and tags, and edit what you need.",
      "Press **Create draft product**.",
    ],
    after: ["Open the draft in Shopify to check the photos, add stock and set it to Active."],
    tips: [
      "Only import products you have the right to sell, with text and photos you're allowed to use.",
    ],
    related: ["ai-descriptions", "ai-page-builder", "ai-credits"],
  },

  "ai-page-audit": {
    intro:
      "AI Page Audit checks a page of your store and lists what to fix to sell more and show up better in search, with a score out of 100 and each fix marked by priority.",
    setup: [
      "Enter the **Page address** of a page in your own store, like your home page or a product page, and press **Generate**.",
      "Work through the list from high priority down.",
    ],
    tips: ["Run it again after making changes to see the score move. Each check uses credits."],
    related: ["ai-visibility", "ai-marketing-plan", "ai-credits"],
  },

  "ai-marketing-plan": {
    intro:
      "AI Marketing Plan writes a 30-day marketing plan for your store from your products and sales: what to do each week, on which channel, and what to measure.",
    setup: [
      "Choose your **Goal**, your **Ad budget** and the **Channels you use**.",
      "Press **Generate** and read the plan. Copy it into your calendar or notes.",
    ],
    related: ["ai-viral-campaign", "ai-social-posts", "ai-credits"],
  },

  "ai-social-posts": {
    intro:
      "AI Social Post Writer writes posts about your products for Facebook, Instagram, TikTok and X, in your brand voice.",
    setup: [
      "Choose a product, or write a **Topic** if the posts aren't about one product.",
      "Pick the **Platforms** and the **Goal**, then press **Generate**.",
      "Copy the posts you like and paste them into each app.",
    ],
    related: ["ai-viral-campaign", "ai-video-ads", "social-buttons"],
  },

  "ai-viral-campaign": {
    intro:
      "AI Viral Campaign gives you a campaign idea people want to share: the hook, how it works, the rules, the posts and the emails to send.",
    setup: [
      "Choose your **Goal**, for example more followers or more email subscribers, then press **Generate**.",
      "Read the idea, change what doesn't fit your store, and copy the posts and emails.",
    ],
    tips: [
      "Giveaways have legal rules in many countries and on every social platform. Check them before you launch.",
    ],
    related: ["ai-marketing-plan", "ai-social-posts", "spin-wheel"],
  },
};
