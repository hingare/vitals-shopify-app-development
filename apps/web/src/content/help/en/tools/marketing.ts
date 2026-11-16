import type { ToolArticle } from "../../types";

/** Marketing tools */
export const marketing: Record<string, ToolArticle> = {
  "social-buttons": {
    intro:
      "Social Share Buttons adds buttons to product pages for sharing the product on Facebook, X, Pinterest, WhatsApp or by email, plus a button to copy the link.",
    setup: [
      "Pick the **Buttons** to show. Two to four is plenty.",
      "Change the **Heading** and pick **Colors**.",
    ],
    after: [
      "To move the buttons, use the [App widget block](/help/widget-placement) and choose Share buttons.",
    ],
    related: ["auto-external-links", "ai-social-posts"],
  },

  "email-marketing": {
    intro:
      "Email Marketing sends campaigns and four automatic emails from the app: welcome, abandoned checkout, review request and win-back. Professional includes {emails} emails a month, and every marketing email has an unsubscribe link.",
    setup: [
      "Keep **Send automatic emails only to subscribers** on unless the rules in your country allow emailing customers who didn't subscribe. People who unsubscribed are never emailed.",
    ],
    after: [
      "Open **Marketing** in the app. Under **Sender details**, set the sender name, a reply-to email, your business address (many countries require it in marketing emails) and the button color.",
      "Under **Automatic emails**, open each one, edit the text, set **Send after**, turn on **Send this email** and save.",
      "To send a newsletter, choose **New campaign**, write it, send yourself a test, then press **Send now** or **Schedule**.",
      "Open **View subscribers** and use **Import from Shopify** to add customers who already agreed to email marketing. Nobody gets a welcome email from the import.",
    ],
    tips: [
      "The email count starts again on the 1st of each month. When the limit is reached, emails are skipped, not sent later, and nothing is charged.",
      "Already use Klaviyo, Mailchimp or Omnisend? Connect them under **Integrations** and new subscribers are sent there too. See [Email sending](/help/email-sending).",
    ],
    faq: [
      {
        q: "Who counts as a subscriber?",
        a: "People who agreed to email marketing: in Shopify, through Pop-up, Spin the Wheel, or the newsletter box in Back in Stock. Consent stays in sync with the customer's record in Shopify.",
      },
      {
        q: "Which emails don't count toward the limit?",
        a: "Test emails, live chat replies and withdrawal confirmations. Everything else, including back-in-stock alerts, counts.",
      },
    ],
    related: ["email-sending", "popup", "spin-wheel"],
  },

  "push-notifications": {
    intro:
      "Push Notifications asks visitors to allow notifications from your store, then lets you send them news and offers from the Marketing page. Notifications arrive even when your store isn't open in their browser.",
    setup: [
      "Edit the **Question** and **Explanation** visitors see before the browser asks for permission.",
      "Change the button texts, set **Seconds after the page opens**, and set **Days before showing again** for visitors who choose Not now.",
      "Decide whether to **Show on mobile**, and pick **Colors**.",
    ],
    after: [
      "Open **Marketing**, then **Push notifications**. Write a title, a message and the page to open, then press **Send notification**.",
    ],
    tips: [
      "Your own question appears first, and the browser's permission box only opens when the visitor clicks Allow. Visitors who say no to a browser box can't be asked again, so this keeps your chances open.",
      "On iPhone and iPad, Apple only allows notifications from sites added to the home screen, so most iPhone visitors won't see the question.",
    ],
    related: ["email-marketing", "back-in-stock"],
  },

  "back-in-stock": {
    intro:
      "Back in Stock gives sold-out products a Notify me button. Shoppers leave their email, and they get one email when the product can be bought again.",
    setup: [
      "Edit the button, heading and thank-you texts.",
      "Keep **Offer to join your newsletter too** on to add an unticked newsletter box. Only shoppers who tick it become subscribers.",
      "Edit the **Email subject**, **Email text** and **Email button text**. `{product}` and `{shop}` are replaced with the product and your store name.",
      "Pick **Colors**.",
    ],
    after: [
      "The button shows on variants that Shopify tracks and that stop selling when out of stock. When Shopify says a variant can be bought again, everyone waiting for it gets the email once.",
    ],
    tips: [
      "Back-in-stock emails go to shoppers who asked for them, even if they didn't join your newsletter. They count toward your monthly email limit.",
      "Selling a product on pre-order instead? Use [Pre-Orders](/help/pre-orders) for those products.",
    ],
    related: ["pre-orders", "stock-scarcity", "email-sending"],
  },

  "spin-wheel": {
    intro:
      "Spin the Wheel shows a prize wheel where shoppers enter their email and spin for a discount. Each slice's size matches its real chance, every winner gets a one-time code, and the code expires exactly when it says.",
    setup: [
      "Choose **When to show** and the **Pages** to show it on.",
      "Edit the **Heading**, **Text**, **Button text** and the **Consent note** under the email field.",
      "Set up to six slices. Each has a prize text, a percent off and a chance. Slices with a chance of 0 or an empty prize are left out.",
      "Set **Days the code stays valid** and **Days before showing again after it's closed**.",
      "Pick **Colors**.",
    ],
    after: [
      "Winners get a one-time discount code made in your Shopify Discounts. Everyone who spins is added to your subscribers.",
    ],
    tips: [
      "Each email can spin once. The result is drawn on our server, not in the browser, so it can't be gamed.",
    ],
    related: ["popup", "email-marketing", "recent-sales"],
  },

  wishlist: {
    intro:
      "Wishlist adds a heart button to product pages so shoppers can save products and find them again later. Logged-in customers see the same list on every device.",
    setup: [
      "Edit the button texts, the list **Title** and the text shown when the list is empty.",
      "Keep **Show a floating wishlist button** on so shoppers can open their list from any page, and choose its side.",
      "Pick **Colors**.",
    ],
    after: [
      "Guests' lists are kept in their browser. When they log in, their list is added to their customer account.",
    ],
    related: ["recently-viewed", "back-in-stock"],
  },

  "order-tracker": {
    intro:
      "Order Tracker gives your store a page where customers check their order status and tracking number. They enter their order number and the email or phone number they ordered with, and orders from the last 60 days are covered.",
    setup: [
      "Edit the **Heading**, **Text**, **Button text** and the text shown when no order matches.",
      "Keep **Show in the footer** on to add a link on every page, and change its **Link text**.",
      "Pick **Colors**.",
    ],
    after: [
      "The tracking page lives at `/apps/app-tools/track` in your store. Add it to your menu in Shopify under Online Store > Navigation, or to [Quick Access Links](/help/quick-links).",
    ],
    tips: [
      "Tracking details come from the fulfillments in Shopify, so add tracking numbers when you fulfill orders.",
    ],
    related: ["quick-links", "shipping-info"],
  },

  "seo-alt-tags": {
    intro:
      "SEO Alt Tags adds alt text to product images that have none, made from a pattern like product name and store name. Alt text helps images show up in Google Images and is read aloud by screen readers. Alt text you wrote yourself is never replaced.",
    setup: [
      "Set the **Alt text pattern**. You can use `{product}`, `{vendor}`, `{type}` and `{shop}`.",
      "Keep **Fill in newly added product images automatically** on so new images get alt text about a minute after upload.",
    ],
    after: [
      "Press **Add alt text** on the tool page, then **Fill in missing alt text** to fill in all your existing images.",
      "To undo, use **Remove the alt text this app added** on the same page. Images whose alt text you changed afterwards are left alone.",
    ],
    tips: [
      "For alt text that describes what's actually in each photo, use [AI Alt Text](/help/ai-alt-text) on Professional.",
    ],
    related: ["ai-alt-text", "seo-meta-templates", "ai-visibility"],
  },

  "facebook-pixels": {
    intro:
      "Facebook Pixels sends page views, product views, add to carts, checkouts and purchases to up to three Meta pixels. It runs as a Shopify web pixel, so it covers checkout too, and only for visitors who allowed marketing cookies.",
    setup: [
      "Copy your pixel ID from Meta Events Manager and paste it into **Pixel ID**, digits only.",
      "Add a second or third pixel if you run ads from more than one ad account.",
    ],
    after: [
      "Saving can take a few minutes to reach your store's pixel. If the app says so, save again a little later.",
    ],
    tips: [
      "Don't add a pixel that the Facebook & Instagram app already sends events to, or each event is counted twice.",
    ],
    related: ["cookies-banner", "analytics", "privacy-data"],
  },

  "visitor-recordings": {
    intro:
      "Visitor Recordings lets you watch replays of how shoppers move through your store: where they click, scroll and get stuck. What shoppers type is always hidden, visitors who decline analytics cookies are not recorded, and recording stops at your monthly limit of {recordings} visits.",
    setup: [
      "Set the **Percent of visitors to record**. Recording fewer makes your monthly limit last longer.",
      "Set **Skip visits shorter than** to leave out visitors who leave at once.",
      "Turn on **Hide all text on the page in recordings** if your pages show private details.",
      "Decide whether to **Record visitors on phones**, and list any **Pages not to record**.",
    ],
    after: [
      "Open **Recordings** from the tool page in the app. Filter by device or length, then play a recording, speed it up or skip quiet moments.",
    ],
    tips: [
      "Checkout, customer account, password and order tracking pages are never recorded.",
      "Recordings are kept for 30 days, then deleted.",
    ],
    related: ["analytics", "cookies-banner", "privacy-data"],
  },
};
