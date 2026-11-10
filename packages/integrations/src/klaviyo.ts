import { expectOk, type EmailToolAdapter, type FetchFn, type ProviderList } from "./types";

/**
 * Klaviyo (private API key, "pk_..." দিয়ে শুরু)।
 * revision নির্দিষ্ট করা, যাতে Klaviyo নতুন সংস্করণ আনলেও আমাদের অনুরোধের গঠন না ভাঙে।
 * Docs: https://developers.klaviyo.com/en/reference/bulk_subscribe_profiles
 */
const BASE = "https://a.klaviyo.com/api";
export const KLAVIYO_REVISION = "2025-07-15";

function headers(apiKey: string) {
  return {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: KLAVIYO_REVISION,
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
  };
}

const post = (fetchFn: FetchFn, apiKey: string, path: string, data: unknown) =>
  fetchFn(`${BASE}${path}`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ data }),
  });

const listRelation = (listId: string | null) =>
  listId ? { relationships: { list: { data: { type: "list", id: listId } } } } : {};

export const klaviyo: EmailToolAdapter = {
  id: "klaviyo",
  hasLists: true,

  async validate(apiKey, fetchFn = fetch) {
    await expectOk(
      await fetchFn(`${BASE}/lists?page[size]=1&fields[list]=name`, { headers: headers(apiKey) }),
    );
  },

  async lists(apiKey, fetchFn = fetch) {
    const out: ProviderList[] = [];
    let url: string | null = `${BASE}/lists?page[size]=10&fields[list]=name&sort=name`;
    // প্রতি পাতায় সর্বোচ্চ ১০টা; ২০ পাতা (২০০ লিস্ট) পর্যন্ত আনি
    for (let page = 0; url && page < 20; page++) {
      const res = await expectOk(await fetchFn(url, { headers: headers(apiKey) }));
      const json = (await res.json()) as {
        data?: Array<{ id: string; attributes?: { name?: string } }>;
        links?: { next?: string | null };
      };
      for (const item of json.data ?? []) {
        out.push({ id: item.id, name: item.attributes?.name ?? item.id });
      }
      const next: string | null = json.links?.next ?? null;
      url = next && next.startsWith(`${BASE}/`) ? next : null;
    }
    return out;
  },

  async subscribe(apiKey, listId, contact, fetchFn = fetch) {
    await expectOk(
      await post(fetchFn, apiKey, "/profile-subscription-bulk-create-jobs", {
        type: "profile-subscription-bulk-create-job",
        attributes: {
          custom_source: contact.source,
          profiles: {
            data: [
              {
                type: "profile",
                attributes: {
                  email: contact.email,
                  subscriptions: { email: { marketing: { consent: "SUBSCRIBED" } } },
                },
              },
            ],
          },
        },
        ...listRelation(listId),
      }),
    );
  },

  /** লিস্ট না দিলে Klaviyo ক্রেতাকে সব মার্কেটিং ইমেইল থেকে বাদ দেয়: আনসাবস্ক্রাইবের ঠিক মানে এটাই */
  async unsubscribe(apiKey, _listId, email, fetchFn = fetch) {
    await expectOk(
      await post(fetchFn, apiKey, "/profile-subscription-bulk-delete-jobs", {
        type: "profile-subscription-bulk-delete-job",
        attributes: {
          profiles: {
            data: [
              {
                type: "profile",
                attributes: {
                  email,
                  subscriptions: { email: { marketing: { consent: "UNSUBSCRIBED" } } },
                },
              },
            ],
          },
        },
      }),
    );
  },

  async event(apiKey, _listId, event, fetchFn = fetch) {
    await expectOk(
      await post(fetchFn, apiKey, "/events", {
        type: "event",
        attributes: {
          properties: event.properties ?? {},
          metric: { data: { type: "metric", attributes: { name: event.name } } },
          profile: { data: { type: "profile", attributes: { email: event.email } } },
        },
      }),
    );
  },
};
