/** Product Labels-এর নিয়ম (কোন প্রোডাক্টে কোন লেবেল) */
export interface LabelSettings {
  showSale: boolean;
  saleText: string;
  showNew: boolean;
  newDays: number;
  newText: string;
  showSoldOut: boolean;
  soldOutText: string;
  customTag: string;
  customText: string;
}

export interface LabelProduct {
  price: number;
  compareAt?: number | null;
  available: boolean;
  tags?: string[];
  createdAt?: string;
}

/** সর্বোচ্চ ২টা লেবেল: Sold out সবার আগে, তারপর Sale, নিজের ট্যাগ, New */
export function labelsFor(p: LabelProduct, s: LabelSettings, now = Date.now()): string[] {
  const out: string[] = [];
  if (s.showSoldOut && !p.available && s.soldOutText) out.push(s.soldOutText);
  if (s.showSale && p.available && p.compareAt && p.compareAt > p.price && s.saleText) {
    const percent = Math.round(((p.compareAt - p.price) / p.compareAt) * 100);
    out.push(s.saleText.replace("{percent}", String(percent)));
  }
  const tag = s.customTag.trim().toLowerCase();
  if (tag && s.customText && p.tags?.some((t) => t.trim().toLowerCase() === tag)) {
    out.push(s.customText);
  }
  const created = p.createdAt ? Date.parse(p.createdAt) : NaN;
  if (s.showNew && s.newText && now - created < s.newDays * 86_400_000) out.push(s.newText);
  return out.slice(0, 2);
}
