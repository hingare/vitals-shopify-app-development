/**
 * প্রতিটা বাইরের সার্ভিসের (Klaviyo, Mailchimp, Omnisend) জন্য একটা করে অ্যাডাপ্টার ফাইল, সবাই এই একই ইন্টারফেস মানে।
 * নতুন সার্ভিস যোগ করা মানে একটা নতুন ফাইল আর index.ts-এ এক লাইন।
 * এখানে কোনো ডাটাবেস নেই: চাবি বাইরে থেকে আসে, আর fetch বদলে টেস্ট করা যায়।
 */
export type FetchFn = typeof fetch;

export interface Contact {
  email: string;
  phone?: string;
  firstName?: string;
  /** কোন টুল থেকে এলো: popup, spin-wheel, back-in-stock, cod-form ... (ট্যাগ হিসেবে যায়) */
  source: string;
}

export interface ProviderList {
  id: string;
  name: string;
}

export interface ContactEvent {
  email: string;
  /** যেমন "Spin won", "Back in stock requested" */
  name: string;
  properties?: Record<string, string | number | boolean>;
}

export class IntegrationError extends Error {
  constructor(
    message: string,
    public status: number,
    /** true হলে পরে আবার চেষ্টা করা যায় (রেট লিমিট, সার্ভারের সাময়িক সমস্যা) */
    public retryable: boolean,
  ) {
    super(message);
  }
}

export interface EmailToolAdapter {
  id: "klaviyo" | "mailchimp" | "omnisend";
  /** Omnisend-এ আলাদা লিস্ট নেই: সব গ্রাহক এক জায়গায়, ট্যাগ দিয়ে আলাদা করা হয় */
  hasLists: boolean;
  /** চাবি ঠিক আছে কিনা; ভুল হলে IntegrationError */
  validate(apiKey: string, fetchFn?: FetchFn): Promise<void>;
  lists(apiKey: string, fetchFn?: FetchFn): Promise<ProviderList[]>;
  subscribe(
    apiKey: string,
    listId: string | null,
    contact: Contact,
    fetchFn?: FetchFn,
  ): Promise<void>;
  unsubscribe(
    apiKey: string,
    listId: string | null,
    email: string,
    fetchFn?: FetchFn,
  ): Promise<void>;
  event(
    apiKey: string,
    listId: string | null,
    event: ContactEvent,
    fetchFn?: FetchFn,
  ): Promise<void>;
}

/** উত্তর ঠিক না হলে IntegrationError ছোড়ে; ignore-এ দেওয়া status নীরবে মেনে নেয় */
export async function expectOk(res: Response, ignore: number[] = []): Promise<Response> {
  if (res.ok || ignore.includes(res.status)) return res;
  const body = await res.text().catch(() => "");
  let detail = body.slice(0, 300);
  try {
    const json = JSON.parse(body) as {
      detail?: string;
      title?: string;
      message?: string;
      error?: string;
      errors?: Array<{ detail?: string; title?: string }>;
    };
    detail =
      json.errors?.[0]?.detail ??
      json.errors?.[0]?.title ??
      json.detail ??
      json.title ??
      json.message ??
      json.error ??
      detail;
  } catch {
    // JSON না হলে যা এসেছে তার শুরুটাই দেখাই
  }
  throw new IntegrationError(
    `${res.status} ${detail}`.trim(),
    res.status,
    res.status === 429 || res.status >= 500,
  );
}
