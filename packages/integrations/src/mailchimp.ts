import { createHash } from "node:crypto";
import {
  IntegrationError,
  expectOk,
  type EmailToolAdapter,
  type FetchFn,
  type ProviderList,
  timedFetch,
} from "./types";

/**
 * Mailchimp Marketing API 3.0 (API key, শেষে ডাটা সেন্টার: "xxxx-us21")।
 * Docs: https://mailchimp.com/developer/marketing/api/list-members/
 */

/** চাবির শেষ অংশ থেকে সার্ভার; অন্য কিছু হলে ভুল চাবি (অচেনা হোস্টে অনুরোধ যাওয়া ঠেকায়) */
export function mailchimpBase(apiKey: string): string {
  const dc = apiKey.split("-").pop() ?? "";
  if (!/^[a-z]{2,4}\d{1,3}$/.test(dc)) {
    throw new IntegrationError("That doesn't look like a Mailchimp API key", 400, false);
  }
  return `https://${dc}.api.mailchimp.com/3.0`;
}

const auth = (apiKey: string) => ({
  Authorization: `Basic ${Buffer.from(`key:${apiKey}`).toString("base64")}`,
  "Content-Type": "application/json",
});

/** Mailchimp সদস্যকে চেনে ছোট হাতের ইমেইলের MD5 দিয়ে */
export const memberHash = (email: string) =>
  createHash("md5").update(email.trim().toLowerCase()).digest("hex");

/** ইভেন্টের নাম: শুধু অক্ষর, সংখ্যা, _ আর -, সর্বোচ্চ ৩০ */
export const mailchimpEventName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 30);

function needList(listId: string | null): string {
  if (!listId) throw new IntegrationError("Choose a Mailchimp audience first", 400, false);
  return listId;
}

async function call(
  fetchFn: FetchFn,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
  ignore: number[] = [],
) {
  return expectOk(
    await fetchFn(`${mailchimpBase(apiKey)}${path}`, {
      method,
      headers: auth(apiKey),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    ignore,
  );
}

export const mailchimp: EmailToolAdapter = {
  id: "mailchimp",
  hasLists: true,

  async validate(apiKey, fetchFn = timedFetch) {
    await call(fetchFn, apiKey, "GET", "/ping");
  },

  async lists(apiKey, fetchFn = timedFetch) {
    const res = await call(fetchFn, apiKey, "GET", "/lists?fields=lists.id,lists.name&count=200");
    const json = (await res.json()) as { lists?: ProviderList[] };
    return (json.lists ?? []).map((l) => ({ id: l.id, name: l.name }));
  },

  /**
   * status_if_new: নতুন হলে subscribed; আগে থেকে থাকলে তার অবস্থা বদলায় না,
   * তাই Mailchimp-এ আনসাবস্ক্রাইব করা কাউকে আমরা ভুল করে আবার চালু করি না।
   */
  async subscribe(apiKey, listId, contact, fetchFn = timedFetch) {
    const list = needList(listId);
    const hash = memberHash(contact.email);
    await call(fetchFn, apiKey, "PUT", `/lists/${list}/members/${hash}`, {
      email_address: contact.email,
      status_if_new: "subscribed",
      ...(contact.firstName ? { merge_fields: { FNAME: contact.firstName } } : {}),
    });
    await call(fetchFn, apiKey, "POST", `/lists/${list}/members/${hash}/tags`, {
      tags: [{ name: contact.source, status: "active" }],
    });
  },

  async unsubscribe(apiKey, listId, email, fetchFn = timedFetch) {
    const list = needList(listId);
    // 404: এই ঠিকানা Mailchimp-এ নেই, তাই করার কিছু নেই
    await call(
      fetchFn,
      apiKey,
      "PATCH",
      `/lists/${list}/members/${memberHash(email)}`,
      { status: "unsubscribed" },
      [404],
    );
  },

  async event(apiKey, listId, event, fetchFn = timedFetch) {
    const list = needList(listId);
    const properties: Record<string, string> = {};
    for (const [key, value] of Object.entries(event.properties ?? {})) {
      properties[key] = String(value);
    }
    // 404: সদস্য এখনো এই audience-এ নেই (গ্রাহক না হলে ইভেন্ট রাখা যায় না)
    await call(
      fetchFn,
      apiKey,
      "POST",
      `/lists/${list}/members/${memberHash(event.email)}/events`,
      { name: mailchimpEventName(event.name), properties },
      [404],
    );
  },
};
