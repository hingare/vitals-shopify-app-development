import type { ToolArticle } from "../../types";

/** Upsell tools. Discount offers are created on the Offers page; see the offers guide. */
export const upsell: Record<string, ToolArticle> = {
  "volume-discounts": {
    intro:
      "Volume Discounts gives a bigger discount when shoppers buy more of the same product, like 10% off 2 and 15% off 3. A table on the product page shows the deal, and Shopify applies the discount at checkout.",
    setup: [
      "Keep **Show the discount table on product pages** on so shoppers see the tiers.",
      "Pick **Colors** for the table.",
    ],
    after: [
      "Open **Offers** in the app and choose **New volume discount**.",
      "Choose the **Products**, or leave the list empty to apply the discount to every product.",
      "Under **Discount by quantity**, add a tier for each step: **Buy at least** a number of items and the discount they get. Choose **Percent off** or **Amount off each item**.",
      "Write a **Discount label**, such as Buy more, save more. Shoppers see it in the cart and checkout.",
      "Turn on **Offer is on** and press **Save**.",
    ],
    tips: [
      "Two or three tiers are easier to understand than five. A common pattern is 10% off 2 and 15% off 3 or more.",
    ],
    faq: [
      {
        q: "Does the discount work with discount codes?",
        a: "Offers combine with order discounts and free shipping codes. They don't stack with other product discounts, so an item never gets two product discounts at once.",
      },
    ],
    related: ["offers", "bundles", "bogo"],
  },

  bundles: {
    intro:
      "Product Bundles sells products together at a discount, with a Buy together box on the product page. Shoppers add the whole bundle with one click, and Shopify applies the discount at checkout.",
    setup: ["Pick **Colors** for the bundle box."],
    after: [
      "Open **Offers** in the app and choose **New bundle**.",
      "Choose 2 to 5 **Products** that go well together.",
      "Set the **Discount** and write the **Box title**, for example Buy together.",
      "Write a **Discount label**, turn on **Offer is on** and press **Save**.",
    ],
    tips: [
      "Bundle products that are bought together anyway, like a phone case and a screen protector. A small discount is usually enough.",
    ],
    related: ["offers", "volume-discounts", "upsells"],
  },

  "free-gifts": {
    intro:
      "Free Gifts adds a free product to the cart when shoppers spend enough or buy certain products. A progress message shows how much more they need to spend, and the gift is free at checkout.",
    setup: [
      "Keep **Add the gift to the cart automatically** on, so shoppers who qualify get the gift without looking for it.",
      "Keep **Show how much more to spend for the gift** on, and pick **Colors**.",
    ],
    after: [
      "Open **Offers** in the app and choose **New free gift**.",
      "Choose the **Gift** product and the **Gift quantity**.",
      "Under **Unlock the gift**, choose the products that unlock it (or any product), and set the **Minimum cart amount** and **Minimum number of items**.",
      "Write the **Progress message**, such as Spend {amount} more for a free gift.",
      "Write a **Discount label**, turn on **Offer is on** and press **Save**.",
    ],
    tips: [
      "The gift product needs to be in stock and available on your online store, or it can't be added to carts.",
      "If a shopper removes the gift from the cart, it isn't added again during that visit.",
    ],
    related: ["offers", "spending-goal", "cart-drawer"],
  },

  bogo: {
    intro:
      "Buy X Get Y runs deals like buy one get one free or buy 2 get the third half price. Product pages show a badge with the offer, and Shopify applies the discount at checkout.",
    setup: [
      "Keep **Show the offer on product pages** on, and pick **Colors** for the badge.",
    ],
    after: [
      "Open **Offers** in the app and choose **New buy X get Y**.",
      "Under **Customer buys**, choose the products and the **Number of items to buy**.",
      "Under **Customer gets**, choose the products (or **Same products as above**), the **Number of items they get** and the **Discount on these items**. 100% makes them free.",
      "Set **Uses per order** to limit how many times one order can use the deal. 0 means no limit.",
      "Write a **Discount label**, turn on **Offer is on** and press **Save**.",
    ],
    tips: [
      "Shoppers need to add the free or discounted items to the cart themselves. Say so in the badge text, like Add 2, get the second free.",
    ],
    related: ["offers", "volume-discounts", "free-gifts"],
  },

  upsells: {
    intro:
      "Upsell Builder suggests more products at the right moment: in a pop-up after adding to cart, on product pages, in the cart and drawer, in checkout on Shopify Plus, and as a one-click offer after payment. You can add a discount to make the offer stronger.",
    setup: [
      "Choose where upsells may appear: **Show the pop-up after adding to cart**, **Show on product pages** and **Show in the cart and cart drawer**.",
      "Pick **Colors**.",
    ],
    after: [
      "Open **Offers** in the app and choose **New upsell**.",
      "Under **Show the offer when**, choose the products that trigger it, or leave it empty to offer it with any product.",
      "Under **Products to offer**, choose 1 to 4 products, and write a **Heading** like Complete the look.",
      "Set a **Discount on the offered products**, or 0 to only suggest them.",
      "Under **Where to show it**, tick the places you want. The checkout spot needs Shopify Plus, and the one-click offer after payment needs Shopify to allow post-purchase offers for your store.",
      "Write a **Discount label**, turn on **Offer is on** and press **Save**.",
    ],
    tips: [
      "Offer something cheaper than what's in the cart and clearly related to it. A charger with a phone works; a second phone doesn't.",
      "The one-click offer after payment adds the product to the same order without asking for payment details again. Offers limited to some customers, countries or an A/B group are not shown there.",
    ],
    related: ["offers", "cart-drawer", "related-products"],
  },

  "cart-drawer": {
    intro:
      "Cart Drawer replaces your theme's cart with one that slides in from the side. Shoppers change quantities, see discounts and upsells, and go to checkout without leaving the page they're on.",
    setup: [
      "Keep **Open the drawer when something is added to the cart** on.",
      "Keep **Use this drawer instead of the theme's cart** on. The cart icon then opens this drawer, and the theme's own drawer or pop-up stays hidden so two carts never open at once.",
      "Change the **Title** and **Checkout button text** if you like.",
      "Keep **Show upsell offers in the drawer** on to show offers you made in Offers, and pick **Colors**.",
    ],
    tips: [
      "Messages from [Cart Notice](/help/cart-notice) show in this drawer too, and gifts added by [Free Gifts](/help/free-gifts) appear without quantity buttons.",
    ],
    related: ["upsells", "free-gifts", "spending-goal"],
  },

  "spending-goal": {
    intro:
      "Spending Goal shows a bar telling shoppers how much more to spend for free shipping or another reward. It updates as the cart changes and celebrates when the goal is reached.",
    setup: [
      "Set the **Goal amount** in your store currency.",
      "Edit the messages. `{goal}` is the goal amount and `{amount}` is how much is left.",
      "Choose the **Position**, whether to **Show on mobile**, and **Colors**.",
    ],
    tips: [
      "The bar shows progress only. Set up the free shipping rate itself in Shopify under Settings > Shipping and delivery, with the same minimum.",
      "Want to give a product instead? Use [Free Gifts](/help/free-gifts), which has its own progress message.",
    ],
    related: ["free-gifts", "announcement-bar", "cart-drawer"],
  },

  "related-products": {
    intro:
      "Related Products shows products that go well with the one being viewed, picked by Shopify's own product recommendations. It fills the end of the product page with more to explore.",
    setup: [
      "Change the **Heading**.",
      "Choose **Which products**: related products are similar to this one, complementary products are items that go with it.",
      "Set **How many products** and pick **Colors**.",
    ],
    tips: [
      "Complementary products have to be set up first in Shopify's free Search & Discovery app. Until then, choose related products.",
      "Your theme may have its own recommendations section. Use one of them, not both.",
    ],
    related: ["recently-viewed", "upsells", "widget-placement"],
  },

  "recently-viewed": {
    intro:
      "Recently Viewed shows shoppers the products they looked at earlier, so they can get back to them easily. The list is kept only in the shopper's own browser.",
    setup: [
      "Change the **Heading** and set **How many products** to show.",
      "Choose the **Pages**: only product pages, or everywhere.",
      "Pick **Colors**.",
    ],
    related: ["related-products", "wishlist", "widget-placement"],
  },
};
