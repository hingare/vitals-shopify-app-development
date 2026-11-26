/**
 * যে লেখাগুলো পাতা আঁকার আগেই লাগে (early.ts, app embed-এর ভেতরে inline)। আলাদা ফাইলে, যাতে inline
 * স্ক্রিপ্টে পুরো অনুবাদের তালিকা না যায়। i18n.ts এগুলো নিজের তালিকায় মিশিয়ে নেয়, তাই widgetT-ও এগুলো দেয়।
 * নতুন ভাষা: দুই ফাইলেই একই ভাষার ব্লক যোগ করুন।
 */
export const earlyStrings = {
  en: {
    buyMoreSave: "Buy more, save more",
    buyQty: "Buy {n}",
    saveValue: "Save {v}",
    each: "each",
    appliedAtCheckout: "Discount is applied in the cart and at checkout.",
    days: "Days",
    hours: "Hours",
    minutes: "Mins",
    seconds: "Secs",
    close: "Close",
  },
} satisfies Record<string, Record<string, string>>;

export type EarlyString = keyof (typeof earlyStrings)["en"];

export function earlyT(locale: string, key: EarlyString): string {
  const base = locale.toLowerCase().split("-")[0] ?? "en";
  const dict = (earlyStrings as Record<string, Partial<Record<EarlyString, string>>>)[base];
  return dict?.[key] ?? earlyStrings.en[key];
}
