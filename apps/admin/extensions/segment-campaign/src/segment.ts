/** অ্যাপের ইমেইল ক্যাম্পেইন এডিটর (অ্যাপের ভেতরের রাস্তা); ?segment= দিলে সেগমেন্টটা আগে থেকেই বেছে রাখা থাকে */
export const CAMPAIGN_EDITOR = "/app/marketing/campaigns/new";

const SEGMENT_GID = /^gid:\/\/shopify\/Segment\/\d+$/;

/** Segments পাতা থেকে আসা id: সাধারণত gid; শুধু সংখ্যা এলে gid বানিয়ে নেওয়া, অন্য কিছু হলে null */
export function segmentGid(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const value = id.trim();
  if (/^\d+$/.test(value)) return `gid://shopify/Segment/${value}`;
  return SEGMENT_GID.test(value) ? value : null;
}

/** সেগমেন্টসহ ক্যাম্পেইন এডিটরের লিংক */
export const campaignLink = (segmentId: string) =>
  `${CAMPAIGN_EDITOR}?segment=${encodeURIComponent(segmentId)}`;
