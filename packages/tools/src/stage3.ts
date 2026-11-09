import { defineTool, themeColors, z } from "@app/tool-sdk";
import { link, text } from "./fields";

/** স্টেজ ৩: Trust ও Conversion টুল */

/** "অর্ডার করুন ২ ঘণ্টার মধ্যে, পৌঁছাবে ১২–১৫ নভেম্বর" (স্টোরের টাইমজোনে, ছুটির দিন বাদ) */
export const shippingInfo = defineTool({
  id: "shipping-info",
  category: "trust",
  plan: "starter",
  surfaces: ["product"],
  delivery: "embed",
  settings: z.object({
    minDays: z.number().int().min(0).max(60).default(3),
    maxDays: z.number().int().min(0).max(90).default(7),
    skipWeekends: z.boolean().default(true),
    cutoffHour: z.number().int().min(0).max(23).default(14),
    deliveryMessage: text(120, "Estimated delivery: {start} – {end}"),
    cutoffMessage: text(120, "Order within {time} to ship today"),
    colors: themeColors({ background: "#F9FAFB", text: "#111827", accent: "#2563EB" }),
  }),
  attribution: ["view"],
});

/** সত্যিকারের সাম্প্রতিক বিক্রি (অর্ডার webhook থেকে); ক্রেতার নাম বা ঠিকানা কখনো দেখায় না */
export const recentSales = defineTool({
  id: "recent-sales",
  category: "trust",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    saleMessage: text(100, "Someone just bought {product}"),
    maxAgeDays: z.number().int().min(1).max(30).default(7),
    firstDelaySeconds: z.number().int().min(2).max(120).default(8),
    intervalSeconds: z.number().int().min(5).max(300).default(25),
    displaySeconds: z.number().int().min(3).max(30).default(6),
    position: z.enum(["bottom-left", "bottom-right"]).default("bottom-left"),
    showOnMobile: z.boolean().default(true),
    colors: themeColors(),
  }),
  attribution: ["view", "click"],
});

/** প্রোডাক্টের ছবিতে লেবেল: Sale, New, Sold out, বা ট্যাগ অনুযায়ী নিজের লেখা */
export const productLabels = defineTool({
  id: "product-labels",
  category: "conversion",
  plan: "starter",
  surfaces: ["product", "collection", "home"],
  delivery: "embed",
  settings: z.object({
    showSale: z.boolean().default(true),
    saleText: text(30, "-{percent}%"),
    showNew: z.boolean().default(true),
    newDays: z.number().int().min(1).max(90).default(14),
    newText: text(30, "New"),
    showSoldOut: z.boolean().default(true),
    soldOutText: text(30, "Sold out"),
    customTag: text(60),
    customText: text(30),
    corner: z.enum(["top-left", "top-right"]).default("top-left"),
    showOnCards: z.boolean().default(true),
    colors: themeColors({ background: "#DC2626", text: "#FFFFFF", accent: "#111827" }),
  }),
});

/** লম্বা বিবরণকে শিরোনাম ধরে ট্যাব বা অ্যাকর্ডিয়নে ভাগ করে */
export const descriptionTabs = defineTool({
  id: "description-tabs",
  category: "conversion",
  plan: "starter",
  surfaces: ["product"],
  delivery: "embed",
  settings: z.object({
    style: z.enum(["tabs", "accordion"]).default("tabs"),
    firstTabTitle: text(40, "Description"),
    accordionOnMobile: z.boolean().default(true),
    colors: themeColors({ background: "#FFFFFF", text: "#111827", accent: "#111827" }),
  }),
});

/** সাইজ চার্ট বাটন ও পপ-আপ; নির্দিষ্ট ট্যাগের প্রোডাক্টে বা সব প্রোডাক্টে */
export const sizeChart = defineTool({
  id: "size-chart",
  category: "conversion",
  plan: "starter",
  surfaces: ["product"],
  delivery: "embed",
  settings: z.object({
    buttonText: text(40, "Size chart"),
    title: text(80, "Size chart"),
    chart: text(
      5000,
      "Size, Chest (in), Waist (in)\nS, 34-36, 28-30\nM, 38-40, 32-34\nL, 42-44, 36-38\nXL, 46-48, 40-42",
    ),
    note: text(300),
    onlyTag: text(60),
    colors: themeColors(),
  }),
  attribution: ["click"],
});

/** Shopify-র নিজের সুপারিশ থেকে "এগুলোও পছন্দ হতে পারে" */
export const relatedProducts = defineTool({
  id: "related-products",
  category: "upsell",
  plan: "starter",
  surfaces: ["product"],
  delivery: "embed",
  settings: z.object({
    heading: text(80, "You may also like"),
    intent: z.enum(["related", "complementary"]).default("related"),
    limit: z.number().int().min(2).max(10).default(4),
    colors: themeColors(),
  }),
  attribution: ["view", "click"],
});

/** ক্রেতা আগে যেসব প্রোডাক্ট দেখেছেন (শুধু তার নিজের ব্রাউজারে রাখা) */
export const recentlyViewed = defineTool({
  id: "recently-viewed",
  category: "upsell",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    heading: text(80, "Recently viewed"),
    limit: z.number().int().min(2).max(12).default(4),
    showOn: z.enum(["everywhere", "product"]).default("product"),
    colors: themeColors(),
  }),
  attribution: ["view", "click"],
});

/** ভাসমান বাটনে দরকারি লিংক (অর্ডার ট্র্যাক, যোগাযোগ, সেল...) */
export const quickLinks = defineTool({
  id: "quick-links",
  category: "conversion",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    buttonText: text(30, "Quick links"),
    link1Label: text(40, "Track my order"),
    link1Url: link().default("/account"),
    link2Label: text(40, "Contact us"),
    link2Url: link().default("/pages/contact"),
    link3Label: text(40),
    link3Url: link(),
    link4Label: text(40),
    link4Url: link(),
    link5Label: text(40),
    link5Url: link(),
    position: z.enum(["bottom-left", "bottom-right"]).default("bottom-left"),
    showOnMobile: z.boolean().default(true),
    colors: themeColors({ background: "#111827", text: "#FFFFFF", accent: "#111827" }),
  }),
  attribution: ["click"],
});

/** "Buy it now" / Apple Pay-র মতো দ্রুত চেকআউট বাটন লুকায় */
export const hideDynamicCheckout = defineTool({
  id: "hide-dynamic-checkout",
  category: "conversion",
  plan: "starter",
  surfaces: ["product", "cart"],
  delivery: "embed",
  settings: z.object({
    hideOnProduct: z.boolean().default(true),
    hideOnCart: z.boolean().default(false),
  }),
});

/** চেকআউটের আগে "শর্তাবলিতে রাজি" টিক দিতে হয় */
export const agreeToTerms = defineTool({
  id: "agree-to-terms",
  category: "trust",
  plan: "starter",
  surfaces: ["cart"],
  delivery: "embed",
  settings: z.object({
    checkboxText: text(150, "I agree to the {terms}"),
    linkText: text(60, "terms and conditions"),
    termsUrl: link().default("/policies/terms-of-service"),
    errorText: text(120, "Please agree to the terms to continue."),
    colors: themeColors({ background: "#FFFFFF", text: "#111827", accent: "#DC2626" }),
  }),
});
