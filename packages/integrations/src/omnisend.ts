import { expectOk, type EmailToolAdapter, type FetchFn, timedFetch } from "./types";

/**
 * Omnisend (API key)। সংস্করণ header দিয়ে নির্দিষ্ট করা।
 * Docs: https://api-docs.omnisend.com/reference/post_contacts
 * আনসাবস্ক্রাইবের body Omnisend-এর ডকে আলাদা উদাহরণ হিসেবে নেই; contact-এর channels.email.status
 * ক্ষেত্রটাই ব্যবহার করা হয়েছে (সাবস্ক্রাইবের মতো একই গঠন)। আসল অ্যাকাউন্টে একবার মিলিয়ে নিতে হবে।
 */
const BASE = "https://api.omnisend.com/api";
export const OMNISEND_VERSION = "2026-03-15";

const headers = (apiKey: string) => ({
  Authorization: `Omnisend-API-Key ${apiKey}`,
  "Omnisend-Version": OMNISEND_VERSION,
  "Content-Type": "application/json",
  Accept: "application/json",
});

const identifier = (email: string, status: "subscribed" | "unsubscribed") => ({
  type: "email",
  id: email,
  channels: { email: { status, statusDate: new Date().toISOString() } },
});

const send = (fetchFn: FetchFn, apiKey: string, method: string, path: string, body: unknown) =>
  fetchFn(`${BASE}${path}`, { method, headers: headers(apiKey), body: JSON.stringify(body) });

export const omnisend: EmailToolAdapter = {
  id: "omnisend",
  hasLists: false,

  async validate(apiKey, fetchFn = timedFetch) {
    await expectOk(await fetchFn(`${BASE}/brands/current`, { headers: headers(apiKey) }));
  },

  async lists() {
    return [];
  },

  async subscribe(apiKey, _listId, contact, fetchFn = timedFetch) {
    await expectOk(
      await send(fetchFn, apiKey, "POST", "/contacts", {
        identifiers: [identifier(contact.email, "subscribed")],
        ...(contact.firstName ? { firstName: contact.firstName } : {}),
        tags: [`source: ${contact.source}`],
      }),
    );
  },

  async unsubscribe(apiKey, _listId, email, fetchFn = timedFetch) {
    // 404: এই ঠিকানা Omnisend-এ নেই
    await expectOk(
      await send(fetchFn, apiKey, "PATCH", `/contacts?email=${encodeURIComponent(email)}`, {
        identifiers: [identifier(email, "unsubscribed")],
      }),
      [404],
    );
  },

  async event(apiKey, _listId, event, fetchFn = timedFetch) {
    await expectOk(
      await send(fetchFn, apiKey, "POST", "/events", {
        eventName: event.name,
        origin: "api",
        contact: { email: event.email },
        properties: event.properties ?? {},
      }),
    );
  },
};
