import { defineTool, themeColors, z } from "@app/tool-sdk";
import { text } from "./fields";

/**
 * Stage 6: ভারী টুল (Recordings, Live Chat, Instant Search), AI টুল আর AI ভিজিবিলিটি ও SEO (মডিউল ৩)।
 * যেসব টুলে আমাদের সার্ভার বা AI-র খরচ আছে সেগুলো Professional-এ, মাসিক সীমা সহ (app/lib/plans.ts)।
 * সীমা পেরোলে টুল থামে, কখনো বাড়তি বিল হয় না।
 */

/**
 * AI দিয়ে বানানোর টুল: চালু-বন্ধের সুইচ নেই, অ্যাডমিনে খুলে ব্যবহার করা হয়।
 * ব্র্যান্ডের সুর, ভাষা ইত্যাদি সব AI টুলের জন্য একবার AI পেজে ঠিক হয়, তাই টুলের নিজের সেটিংস নেই।
 */
const aiTool = (id: string) =>
  defineTool({
    id,
    category: "ai",
    plan: "professional",
    surfaces: ["all"],
    delivery: "admin",
    alwaysOn: true,
    settings: z.object({}),
  });

/** প্রোডাক্টের বর্ণনা (আর চাইলে SEO টাইটেল ও বর্ণনা) লেখে; আগে প্রিভিউ, পছন্দ হলে প্রোডাক্টে বসে */
export const aiDescriptions = aiTool("ai-descriptions");
/** ছবির পেছনের অংশ সরিয়ে স্বচ্ছ বা সাদা পটভূমি */
export const aiBackgroundRemover = aiTool("ai-background-remover");
/** ছবি পরিষ্কার ও বড় করে (upscale), বা চারপাশ বাড়িয়ে নতুন মাপে আনে (expand) */
export const aiImageEnhancer = aiTool("ai-image-enhancer");
/** প্রোডাক্টের ছবি দিয়ে নতুন দৃশ্যে ফটোশুট (স্টুডিও, প্রকৃতি, রান্নাঘর ...) */
export const aiPhotoshoots = aiTool("ai-photoshoots");
/** প্রোডাক্টের ছবি থেকে ছোট ভিডিও */
export const aiImageToVideo = aiTool("ai-image-to-video");
/** বিজ্ঞাপনের ভিডিও: ছবি থেকে চলমান দৃশ্য আর তার সাথে বিজ্ঞাপনের লেখা */
export const aiVideoAds = aiTool("ai-video-ads");
/** একটা বিষয় দিলে পুরো ল্যান্ডিং পেজ (খসড়া হিসেবে স্টোরের Pages-এ) */
export const aiPageBuilder = aiTool("ai-page-builder");
/** সাপ্লায়ার বা নিজের অন্য সাইটের প্রোডাক্ট পেজ থেকে খসড়া প্রোডাক্ট */
export const aiProductImporter = aiTool("ai-product-importer");
/** স্টোরের একটা পেজ পরীক্ষা করে কী ঠিক করলে বিক্রি আর SEO বাড়বে তার তালিকা */
export const aiPageAudit = aiTool("ai-page-audit");
/** স্টোরের তথ্য দেখে ৩০ দিনের মার্কেটিং পরিকল্পনা */
export const aiMarketingPlan = aiTool("ai-marketing-plan");
/** প্রোডাক্টের জন্য Facebook, Instagram, TikTok, X-এর পোস্ট */
export const aiSocialPosts = aiTool("ai-social-posts");
/** ছড়িয়ে পড়ার মতো ক্যাম্পেইনের ধারণা: হুক, নিয়ম, পোস্ট আর ইমেইল */
export const aiViralCampaign = aiTool("ai-viral-campaign");
/** প্রোডাক্টের ছবি দেখে alt লেখা; মার্চেন্ট দেখে তারপর বসায় */
export const aiAltText = aiTool("ai-alt-text");

/**
 * AI SEO Schema: Google আর AI সার্চের জন্য JSON-LD (Product, Offer, AggregateRating, Organization,
 * WebSite, BreadcrumbList)। app embed-এর Liquid সার্ভারেই লেখে, JS লাগে না।
 * টুলের ছোট JS শুধু "থিমের একই schema সরাও" চালু থাকলে কাজ করে।
 */
export const aiSeoSchema = defineTool({
  id: "ai-seo-schema",
  category: "ai",
  plan: "starter",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    productSchema: z.boolean().default(true),
    organizationSchema: z.boolean().default(true),
    breadcrumbSchema: z.boolean().default(true),
    /** ফেরতের নিয়ম (Google-এর merchant listing-এ দেখায়); ০ = দেখানো হয় না */
    returnDays: z.number().int().min(0).max(365).default(0),
    returnFees: z.enum(["free", "customer-pays"]).default("free"),
    /** থিম নিজেও Product বা Organization schema দিলে সেটা সরানো (Google JS চালিয়ে পড়ে, তাই সেখানে কাজ করে) */
    removeThemeDuplicates: z.boolean().default(false),
  }),
});

/** llms.txt: AI ক্রলারের জন্য স্টোরের সারাংশ, কালেকশন, পলিসি আর প্রোডাক্টের তালিকা (/llms.txt) */
export const llmsTxt = defineTool({
  id: "llms-txt",
  category: "ai",
  plan: "starter",
  surfaces: ["all"],
  delivery: "admin",
  settings: z.object({
    /** স্টোরের পরিচয় নিজের ভাষায়; ফাঁকা থাকলে Shopify-র স্টোর বর্ণনা */
    storeSummary: text(600),
    productLimit: z.number().int().min(10).max(200).default(50),
    includeCollections: z.boolean().default(true),
    includePolicies: z.boolean().default(true),
    includePages: z.boolean().default(true),
    /** /llms-full.txt: প্রোডাক্টের বর্ণনাসহ বড় সংস্করণ */
    fullVersion: z.boolean().default(true),
  }),
});

/**
 * মেটা টাইটেল ও বর্ণনার টেমপ্লেট: যে প্রোডাক্ট বা কালেকশনের SEO ঘর ফাঁকা, শুধু সেখানে বসায়।
 * মার্চেন্টের নিজের লেখা কখনো বদলায় না, আর এক ক্লিকে আগের অবস্থায় ফেরানো যায়।
 */
export const seoMetaTemplates = defineTool({
  id: "seo-meta-templates",
  category: "ai",
  plan: "starter",
  surfaces: ["all"],
  delivery: "admin",
  settings: z.object({
    productTitle: text(120, "{product} | {shop}"),
    productDescription: text(320, "{description}"),
    collectionTitle: text(120, "{collection} | {shop}"),
    collectionDescription: text(320, "{description}"),
    autoFillNew: z.boolean().default(true),
  }),
});

/** প্রোডাক্ট পেজে প্রশ্ন-উত্তর (AI দিয়ে লেখা, মার্চেন্ট দেখে নেন); থিমের ব্লক সার্ভারেই দেখায় আর FAQ schema দেয় */
export const aiProductFaq = defineTool({
  id: "ai-product-faq",
  category: "ai",
  plan: "professional",
  surfaces: ["product"],
  delivery: "block",
  settings: z.object({
    heading: text(80, "Frequently asked questions"),
    faqSchema: z.boolean().default(true),
    colors: themeColors(),
  }),
});

/** রিভিউ উইজেটের উপরে "ক্রেতারা যা বলছেন": ভালো আর খারাপ দিকসহ ছোট সারাংশ, নতুন রিভিউ এলে আবার লেখা হয় */
export const aiReviewSummary = defineTool({
  id: "ai-review-summary",
  category: "ai",
  plan: "professional",
  surfaces: ["product"],
  delivery: "admin",
  settings: z.object({
    heading: text(80, "What customers say"),
    minReviews: z.number().int().min(3).max(50).default(5),
    autoRefresh: z.boolean().default(true),
  }),
});

/**
 * Visitor Recordings: ক্রেতা কীভাবে স্টোর ঘুরল তার রিপ্লে (rrweb)। ইনপুটের লেখা সবসময় ঢাকা থাকে,
 * ক্রেতা অ্যানালিটিক্সে রাজি না হলে রেকর্ড হয় না, আর মাসিক সীমায় পৌঁছালে রেকর্ড থামে।
 */
export const visitorRecordings = defineTool({
  id: "visitor-recordings",
  category: "marketing",
  plan: "professional",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    /** কত শতাংশ ভিজিটর রেকর্ড হবে (মাসিক সীমা ধীরে ফুরানোর জন্য) */
    samplePercent: z.number().int().min(1).max(100).default(50),
    /** এর চেয়ে ছোট সেশন রাখা হয় না (সেকেন্ড) */
    minSeconds: z.number().int().min(0).max(120).default(5),
    /** পেজের সব লেখাও ঢাকা থাকবে (ইনপুট সবসময় ঢাকা) */
    maskText: z.boolean().default(false),
    recordMobile: z.boolean().default(true),
    /** এই পথগুলোতে রেকর্ড হবে না, কমা দিয়ে আলাদা, যেমন /pages/contact */
    excludePaths: text(500),
  }),
});

/** Live Chat: স্টোরেই ক্রেতার সাথে কথা; মার্চেন্ট অ্যাপের Chat পেজ থেকে উত্তর দেন, অনলাইনে না থাকলে ইমেইলে খবর যায় */
export const liveChat = defineTool({
  id: "live-chat",
  category: "conversion",
  plan: "professional",
  surfaces: ["all"],
  delivery: "embed",
  conflictsWith: ["chat-button"],
  settings: z.object({
    title: text(60, "Chat with us"),
    welcomeMessage: text(240, "Hi! How can we help you today?"),
    offlineText: text(240, "We're away right now. Leave a message and we'll reply by email."),
    /** কখন ইমেইল চাওয়া হবে: সবসময়, শুধু অফলাইনে, কখনো না */
    askEmail: z.enum(["always", "offline", "never"]).default("offline"),
    position: z.enum(["bottom-right", "bottom-left"]).default("bottom-right"),
    showOnMobile: z.boolean().default(true),
    colors: themeColors({ accent: "#2563EB" }),
  }),
  attribution: ["view", "click"],
});

/** Instant Search: টাইপ করতেই প্রোডাক্ট, কালেকশন আর পেজের ফল (Shopify-র নিজের predictive search, তাই সার্ভারের খরচ নেই) */
export const instantSearch = defineTool({
  id: "instant-search",
  category: "conversion",
  plan: "professional",
  surfaces: ["all"],
  delivery: "embed",
  settings: z.object({
    placeholder: text(80, "Search products"),
    limit: z.number().int().min(3).max(10).default(6),
    showPrices: z.boolean().default(true),
    showCollections: z.boolean().default(true),
    showPages: z.boolean().default(true),
    /** কিছু না লিখে খুললে দেখানো জনপ্রিয় খোঁজ, কমা দিয়ে আলাদা */
    popularSearches: text(300),
    colors: themeColors(),
  }),
  attribution: ["view", "click", "add_to_cart"],
});
