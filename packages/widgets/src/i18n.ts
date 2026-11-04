/**
 * স্টোরে ক্রেতারা যে লেখা দেখে। এখন শুধু ইংরেজি।
 * নতুন ভাষা: নিচে একটা ব্লক যোগ করুন (যেমন `bn: { addToCart: "কার্টে যোগ করুন", ... }`)।
 * স্টোরের ভাষা (request.locale) মিলে গেলে সেটাই দেখাবে, না মিললে ইংরেজি।
 */
const strings = {
  en: {
    addToCart: "Add to cart",
    added: "Added",
    soldOut: "Sold out",
  },
} satisfies Record<string, Record<string, string>>;

export type WidgetString = keyof (typeof strings)["en"];

export function widgetT(locale: string, key: WidgetString): string {
  const base = locale.toLowerCase().split("-")[0] ?? "en";
  const dict = (strings as Record<string, Partial<Record<WidgetString, string>>>)[base];
  return dict?.[key] ?? strings.en[key];
}
