/**
 * ui.tsx-এর buttonStyle(colors, true)-এর মতো রেখা-বাটন, CSS লেখা হিসেবে। early.ts-এর বাটন (Wishlist,
 * স্টকে এলে জানাও) আর টুলের নিজের বাটন একই মাপের হতে হয়, নইলে টুল এসে বদলালে পাতা সরে; logic.test.ts মিলিয়ে দেখে।
 */
export const outlinedButton = (accent: string) =>
  `background:none;color:inherit;border:1px solid ${accent};border-radius:8px;padding:12px 18px;min-height:44px;box-sizing:border-box;font-size:15px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block;text-align:center;font-family:inherit`;
