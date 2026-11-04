/**
 * অ্যাপের নাম, লোগো ও রং এক জায়গায়।
 * আসল নাম ঠিক হলে (স্টেজ ৯) শুধু এই ফাইল বদলালেই অ্যাপ, উইজেট ও ওয়েবসাইটে সব জায়গায় বদলে যাবে।
 */
export const brand = {
  /** অস্থায়ী নাম, লঞ্চের আগে বদলানো হবে */
  name: "AllInOne",
  slug: "allinone",
  tagline: "Shopify-র জন্য সব দরকারি টুল, এক অ্যাপে",
  supportEmail: "support@example.com",
  website: "https://example.com",
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
} as const;

export type Brand = typeof brand;
