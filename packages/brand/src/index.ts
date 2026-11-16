/**
 * অ্যাপের নাম, লোগো ও রং এক জায়গায়।
 * আসল নাম ঠিক হলে (স্টেজ ৯) শুধু এই ফাইল বদলালেই অ্যাপ, উইজেট ও ওয়েবসাইটে সব জায়গায় বদলে যাবে।
 */
export const brand = {
  /** অস্থায়ী নাম, লঞ্চের আগে বদলানো হবে */
  name: "AllInOne",
  slug: "allinone",
  /** ওয়েবসাইটের শিরোনাম ও সার্চ ফলাফলে দেখায় (ইংরেজি সাইটের জন্য ইংরেজিতে) */
  tagline: "Every tool your Shopify store needs, in one app",
  supportEmail: "support@example.com",
  /** ওয়েবসাইটের ঠিকানা। ডিপ্লয়ের সময় NEXT_PUBLIC_SITE_URL দিলে সেটাই ব্যবহার হয়। */
  website: "https://example.com",
  /**
   * Shopify App Store-এর লিস্টিং। লিস্টিং চালু না হওয়া পর্যন্ত null: তখন ওয়েবসাইটের বাটন
   * "প্রাইভেট বিটায় যোগ দিন" দেখায় আর সাপোর্ট ইমেইলে পাঠায়।
   */
  appStoreUrl: null as string | null,
  /** সোশ্যাল প্রোফাইলের পুরো লিংক (খালি থাকলে কোথাও দেখায় না) */
  social: [] as string[],
  /**
   * আইনি তথ্য: Privacy Policy ও Terms-এ দেখায়। `reviewed` false থাকলে ওই দুটো পেজে
   * "খসড়া" নোট দেখায়; আইনজীবী দেখে নেওয়ার পরে true করুন।
   */
  legal: {
    companyName: "AllInOne",
    address: "",
    governingLaw: "",
    privacyEmail: "privacy@example.com",
    reviewed: false,
  },
  logo: {
    light: "/brand/logo-light.svg",
    dark: "/brand/logo-dark.svg",
  },
  colors: {
    primary: "#4F46E5",
    primaryDark: "#4338CA",
    success: "#16A34A",
    warning: "#D97706",
    critical: "#DC2626",
  },
};

export type Brand = typeof brand;
