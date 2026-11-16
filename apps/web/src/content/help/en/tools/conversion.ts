import type { ToolArticle } from "../../types";

/** Conversion tools. Settings and their defaults are added to each page from the app itself. */
export const conversion: Record<string, ToolArticle> = {
  "sticky-atc": {
    intro:
      "Sticky Add to Cart pins a slim bar with the product name, price and an Add to cart button to the bottom or top of product pages. Shoppers who scroll down to read the description or reviews can buy without scrolling back up.",
    setup: [
      "Choose **Position**: the bottom of the screen suits most themes, the top works better if your theme already has something fixed at the bottom.",
      "Decide whether the bar should also show on phones with **Show on mobile**.",
      "Pick **Colors** that match your Add to cart button.",
    ],
    after: [
      "Open any product page in your store and scroll down. The bar shows the variant the shopper has selected, with its own price, and switches to Sold out for variants that can't be bought.",
    ],
    tips: [
      "If the bar covers a chat button or another floating element, move that element to the other corner or put the bar at the top.",
    ],
    faq: [
      {
        q: "Which variant does the bar add to the cart?",
        a: "The one the shopper has selected in your theme's product form. When they pick another size or color, the bar follows, including the price and whether it's in stock.",
      },
    ],
    related: ["animated-atc", "accelerated-checkout", "app-embed"],
  },

  "cart-notice": {
    intro:
      "Cart Notice shows a short message in the cart and cart drawer. Use it for facts that help shoppers decide, like shipping times, return rules or a holiday cut-off date.",
    setup: [
      "Write your **Message**. Keep it to one sentence that is true for every order.",
      "Pick an **Icon** that fits the message, or Plain for text only.",
      "Choose **Colors** that stand out a little from your cart without looking like an error.",
    ],
    tips: [
      "The default message says items are not reserved, which is true for every Shopify store. Avoid wording that suggests a timer or a reservation you don't actually have.",
    ],
    related: ["spending-goal", "cart-drawer", "agree-to-terms"],
  },

  "accelerated-checkout": {
    intro:
      "Accelerated Checkout adds a Buy it now button under your Add to cart button that takes shoppers straight to checkout with the selected product. You can also make the normal Add to cart button skip the cart and go to checkout.",
    setup: [
      "Keep **Show a Buy it now button** on and change the **Button text** if you like.",
      "Turn on **Go straight to checkout after Add to cart** only if most of your orders are a single product. Shoppers who want to buy several items will then have to come back from checkout.",
      "Choose **Colors** for the button.",
    ],
    tips: [
      "Want only one quick-buy button? [Hide Dynamic Checkout Buttons](/help/hide-dynamic-checkout) hides Shopify's own Buy it now and express buttons and leaves this one in place.",
    ],
    related: ["sticky-atc", "hide-dynamic-checkout", "cart-drawer"],
  },

  "pre-orders": {
    intro:
      "Pre-Orders lets you keep selling products that are sold out. The Add to cart button changes to Pre-order, shoppers see when it ships, and every pre-ordered item is marked on the order so you know what to send later.",
    setup: [
      "In Shopify, open the product and make sure **Track quantity** is on and **Continue selling when out of stock** is ticked. Pre-Orders only changes products that are set up this way.",
      "Back in the app, change the **Button text** and **Pre-order message** if you like. `{date}` in the message is replaced with the ship date.",
      "Set the **Expected ship date**. Leave it empty if you don't know it yet, and the message is shown without a date.",
      "To limit pre-orders to some products, add a tag such as `preorder` to them in Shopify and enter it in **Only for products with this tag**.",
    ],
    after: [
      "When a pre-order item is in an order, its line in the Shopify order shows a Pre-order note with the message, so your team can see it while packing.",
    ],
    tips: [
      "Express buttons like Shop Pay don't carry the pre-order note, so they are hidden on products while they are on pre-order.",
      "Shopify keeps selling a product set to continue selling out of stock, with or without this tool. Pre-Orders makes that clear to the shopper.",
    ],
    faq: [
      {
        q: "Do shoppers pay now or later?",
        a: "They pay at checkout like any other order. If you want to take payment later, use Shopify's own purchase options for that, and keep this tool for the button and the message.",
      },
    ],
    related: ["back-in-stock", "stock-scarcity", "shipping-info"],
  },

  "announcement-bar": {
    intro:
      "Announcement Bar puts a thin bar at the top or bottom of every page for news, a sale or a free shipping message. Add up to three messages and they take turns.",
    setup: [
      "Write **Message 1**, and add **Message 2** and **Message 3** if you want the bar to rotate between them.",
      "Add a **Link** if the bar should open a page, for example `/collections/sale`.",
      "Choose how many **Seconds per message** to show each one when there are several.",
      "Pick the **Position**, whether it should **Stay visible while scrolling**, and whether **Shoppers can close it**.",
    ],
    tips: [
      "Many themes have their own announcement bar. If yours is turned on, switch one of them off so shoppers don't see two.",
      "A short message with one clear offer works better than three long ones.",
    ],
    related: ["spending-goal", "countdown-timer", "popup"],
  },

  "countdown-timer": {
    intro:
      "Countdown Timer shows how long is left until your sale ends, on product pages. It counts down to the real end date you set and hides itself when the sale is over, so it never shows a fake deadline.",
    setup: [
      "Set the **Sale end date** and the **Sale end time** (24-hour clock, like 23:59). The time is in your store's time zone, as set in Shopify under Settings > General.",
      "Change the **Message** shown before the timer if you like.",
      "Pick **Colors** for the timer.",
    ],
    after: [
      "The timer appears below the product form until the end time passes, then disappears on its own. With no end date set, nothing is shown.",
      "To place the timer somewhere else, use the [App widget block](/help/widget-placement) and choose Countdown timer.",
    ],
    tips: [
      "The timer doesn't change your prices. Set up the sale itself in Shopify with compare-at prices or a discount, and end it at the same time.",
    ],
    faq: [
      {
        q: "Does the timer restart for each visitor?",
        a: "No. Every visitor sees the same countdown to the same moment. Timers that restart per visitor are misleading, so this tool doesn't offer them.",
      },
    ],
    related: ["stock-scarcity", "announcement-bar", "recent-sales"],
  },

  "stock-scarcity": {
    intro:
      "Stock Scarcity shows a message like \"Only 3 left\" on product pages when the real stock of the selected variant is low. The number comes from your Shopify inventory, so it is always true.",
    setup: [
      "Set **Show when stock is at or below**. With the default of 10, the message appears when 10 or fewer are left.",
      "Edit the **Message**. `{n}` is replaced with the number in stock.",
      "Choose whether to **Show a stock bar** and pick **Colors**.",
    ],
    after: [
      "The message only appears for variants whose quantity Shopify tracks. Products with Track quantity turned off never show it.",
    ],
    related: ["countdown-timer", "back-in-stock", "pre-orders"],
  },

  "chat-button": {
    intro:
      "Chat Button adds a floating button that opens a conversation with you in WhatsApp, Messenger, Telegram, a phone call or email. Shoppers reach you in the app they already use.",
    setup: [
      "Choose the **Chat app**.",
      "Enter **Your number, username or email**. For WhatsApp and phone, use the full number with the country code, like +8801712345678.",
      "Write the **First message** that is filled in for shoppers (used by WhatsApp and email).",
      "Change the **Button text**, or leave it empty for an icon-only button, and pick the **Position**.",
    ],
    tips: [
      "Chat Button can't run together with [Live Chat](/help/live-chat). Pick Live Chat if you want to answer inside the app instead.",
    ],
    related: ["live-chat", "quick-links"],
  },

  popup: {
    intro:
      "Pop-up shows a window to collect email addresses or promote an offer. Emails go into Shopify as customers subscribed to email marketing, so you can use them with any email tool.",
    setup: [
      "Choose **When to show**: after a few seconds, when the shopper is about to leave, or after they scroll part of the page.",
      "Choose the **Pages** to show it on.",
      "Write the **Heading** and **Text**. Keep **Ask for an email** on to collect sign-ups, or turn it off and add a **Button link** to promote a page instead.",
      "Optionally enter a **Discount code shown after signing up**. Create that code in Shopify under Discounts first.",
      "Set **Days before showing again after it's closed** so returning visitors aren't asked every time.",
    ],
    after: [
      "New subscribers appear in Shopify under Customers with email marketing set to subscribed, and on the app's Subscribers page.",
    ],
    tips: [
      "Leaving the page can only be noticed with a mouse, so on phones a pop-up set to show on exit appears after the delay instead.",
      "If you want a game with prizes instead, look at [Spin the Wheel](/help/spin-wheel).",
    ],
    related: ["spin-wheel", "email-marketing", "email-sending"],
  },

  "scroll-to-top": {
    intro:
      "Scroll to Top adds a small round button that takes shoppers back to the top of long pages, like big collections or long product descriptions.",
    setup: [
      "Pick the **Position** and how far shoppers scroll before it appears with **Show after scrolling (px)**.",
      "Decide whether to **Show on mobile** and pick **Colors**.",
    ],
    tips: [
      "Put it in the opposite corner from a chat button so the two don't overlap.",
    ],
    related: ["quick-links", "chat-button"],
  },

  "inactive-tab-message": {
    intro:
      "Inactive Tab Message changes the title of the browser tab when a shopper switches to another tab, for example to \"Come back, we miss you!\". The normal title returns as soon as they come back.",
    setup: [
      "Write the **Message** shown in the tab title.",
      "Turn on **Only when the cart has items** if you only want to remind shoppers who have added something.",
    ],
    tips: ["Keep it short. Browsers cut long tab titles after a few words."],
    related: ["favicon-cart-count"],
  },

  "animated-atc": {
    intro:
      "Animated Add to Cart gently moves the Add to cart button every few seconds so shoppers notice it. The animation stops for shoppers who have asked their device to reduce motion.",
    setup: [
      "Choose an **Animation**: shake, pulse, bounce or wobble.",
      "Set **Seconds between each time**. A longer gap is less distracting.",
    ],
    related: ["sticky-atc", "accelerated-checkout"],
  },

  "auto-external-links": {
    intro:
      "Auto External Links opens links to other websites in a new browser tab, so shoppers who click a link to your Instagram or a size guide on another site still have your store open.",
    setup: ["This tool has no settings."],
    tips: ["Links to pages of your own store keep opening in the same tab."],
    related: ["social-buttons"],
  },

  "favicon-cart-count": {
    intro:
      "Favicon Cart Count shows the number of items in the cart on the small icon in the browser tab. Shoppers with many tabs open can see your store still has their cart.",
    setup: ["Pick **Colors** for the number badge."],
    tips: [
      "The number is drawn on the corner of your store's favicon, which you set in your theme settings. Above 9 items it shows 9+.",
    ],
    related: ["inactive-tab-message"],
  },

  "product-labels": {
    intro:
      "Product Labels adds Sale, New, Sold out or your own labels to product photos, on product pages and in product lists like collections and the home page.",
    setup: [
      "Keep **Sale label when the price is reduced** on to label products that have a compare-at price. `{percent}` in the text shows the discount.",
      "Keep **New label for new products** on and set how many days a product counts as new.",
      "Keep **Sold out label** on to mark products that can't be bought.",
      "To add your own label, enter a tag in **Products with this tag...** and the text in **...get this label**, then add that tag to products in Shopify.",
      "Choose the **Corner** and whether labels also show **on product lists**.",
    ],
    tips: [
      "Many themes add their own Sale and Sold out badges. If you see two, turn off the theme's badges in its settings or turn off the matching label here.",
    ],
    related: ["stock-scarcity", "countdown-timer"],
  },

  "description-tabs": {
    intro:
      "Description Tabs splits long product descriptions into tabs or an accordion, using the headings you already have in the description. Shoppers see a tidy page and open the part they care about.",
    setup: [
      "Choose a **Style**: tabs or an accordion.",
      "Set the **Title of the first part**, used for the text before your first heading.",
      "Keep **Use an accordion on phones** on, because tabs get cramped on small screens.",
    ],
    after: [
      "In Shopify, add headings to a product description (for example Details, Care and Shipping) using the heading style in the editor. Descriptions without headings are left as they are.",
    ],
    tips: ["Use the same headings on every product so shoppers know where to look."],
    related: ["size-chart", "ai-descriptions"],
  },

  "size-chart": {
    intro:
      "Size Chart adds a Size chart button to product pages that opens your size table in a window. Shoppers can check their size without leaving the page.",
    setup: [
      "Change the **Button text** and the window **Title** if you like.",
      "Write your **Size table**: one row per line, with cells separated by commas. The first line is the header, for example `Size, Chest (in), Waist (in)`.",
      "Add a **Note under the table**, like how to measure.",
      "To show the chart only on clothing, tag those products in Shopify (for example `size-chart`) and enter the tag in **Only for products with this tag**.",
    ],
    tips: [
      "The same chart is used on every product it shows on, so use the tag setting to keep it off products it doesn't fit.",
    ],
    related: ["description-tabs", "widget-placement"],
  },

  "quick-links": {
    intro:
      "Quick Access Links adds a floating button that opens a small menu of your most useful links, like order tracking, contact, shipping or returns.",
    setup: [
      "Change the **Button text**.",
      "Fill in up to five links. Each needs a text and an address, such as `/pages/contact` for a page of your store or a full https:// link.",
      "Pick the **Position**, whether to **Show on mobile**, and **Colors**.",
    ],
    tips: [
      "Turned on [Order Tracker](/help/order-tracker)? Point a link at `/apps/app-tools/track` so customers find it.",
    ],
    related: ["order-tracker", "chat-button", "scroll-to-top"],
  },

  "hide-dynamic-checkout": {
    intro:
      "Hide Dynamic Checkout Buttons hides Shopify's Buy it now and express payment buttons (like Shop Pay, PayPal or Google Pay) on product pages, and optionally on the cart page, so shoppers add to cart first.",
    setup: [
      "Keep **Hide on product pages** on.",
      "Turn on **Hide on the cart page** only if you want every shopper to go through your cart, for example to see a free gift or terms box.",
    ],
    tips: [
      "Express buttons are fast for shoppers who already use them. Hide them only when the cart matters for your orders, for example with [Agree to Terms](/help/agree-to-terms) or gifts.",
    ],
    related: ["agree-to-terms", "accelerated-checkout", "cart-drawer"],
  },

  "live-chat": {
    intro:
      "Live Chat lets shoppers write to you from a chat window in your store, and you answer from the Chat page in the app. When you're away, shoppers can leave their email and get your reply there.",
    setup: [
      "Change the **Title**, **Welcome message** and **Message when you're away** if you like.",
      "Choose when to **Ask for the shopper's email**: always, only when you're away, or never.",
      "Pick the **Position**, whether to **Show on mobile**, and **Colors**.",
    ],
    after: [
      "Open **Chat** in the app to answer. You show as online to shoppers while the Chat page is open, and as away when it's closed.",
      "Add a reply-to email on the Marketing page to get an email when a shopper writes while you're away.",
    ],
    tips: [
      "Replies sent while the shopper has left the store go to their email, if they gave one. Replies by email don't count toward your monthly email limit.",
      "Chats with no new messages for 180 days are deleted.",
    ],
    faq: [
      {
        q: "Can I use Live Chat and Chat Button together?",
        a: "No. They would put two chat buttons in the same corner, so the app asks you to choose one.",
      },
    ],
    related: ["chat-button", "email-sending", "privacy-data"],
  },

  "instant-search": {
    intro:
      "Instant Search shows matching products, collections and pages while shoppers type in your store's search box. Results come from Shopify's own search, so they follow your Shopify search settings.",
    setup: [
      "Change the **Search box text**.",
      "Set **How many products** to show and whether to show prices, collections and pages.",
      "Add **Popular searches**, separated by commas, to suggest searches before the shopper types.",
    ],
    after: [
      "Click the search icon or box in your store. The panel opens with popular and recent searches, then shows results as the shopper types.",
    ],
    tips: [
      "To change which products rank first, use Shopify's free Search & Discovery app. Instant Search follows it.",
    ],
    related: ["related-products", "recently-viewed"],
  },
};
