import { describe, expect, it, vi } from "vitest";
import {
  EMAIL_TOOLS,
  IntegrationError,
  mailchimpBase,
  mailchimpEventName,
  memberHash,
} from "./index";

const ok = (body: unknown = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function recorder(...responses: Response[]) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> =
    [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body:
        typeof init?.body === "string" && init.body.startsWith("{")
          ? JSON.parse(init.body)
          : init?.body,
    });
    return responses.shift() ?? ok();
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const contact = { email: "rahim@example.com", firstName: "Rahim", source: "spin-wheel" };

describe("klaviyo", () => {
  it("subscribes a profile to the chosen list with email consent", async () => {
    const { calls, fetchFn } = recorder(ok({}, 202));
    await EMAIL_TOOLS.klaviyo.subscribe("pk_test", "LIST1", contact, fetchFn);
    expect(calls[0]?.url).toBe("https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs");
    expect(calls[0]?.headers.Authorization).toBe("Klaviyo-API-Key pk_test");
    expect(calls[0]?.headers.revision).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const data = calls[0]?.body.data;
    expect(data.relationships.list.data).toEqual({ type: "list", id: "LIST1" });
    expect(data.attributes.custom_source).toBe("spin-wheel");
    expect(data.attributes.profiles.data[0].attributes).toEqual({
      email: "rahim@example.com",
      subscriptions: { email: { marketing: { consent: "SUBSCRIBED" } } },
    });
  });

  it("unsubscribes globally and sends events with a metric name", async () => {
    const { calls, fetchFn } = recorder(ok({}, 202), ok({}, 202));
    await EMAIL_TOOLS.klaviyo.unsubscribe("pk_test", "LIST1", "a@b.co", fetchFn);
    await EMAIL_TOOLS.klaviyo.event(
      "pk_test",
      null,
      { email: "a@b.co", name: "Spin won", properties: { prize: "10% off" } },
      fetchFn,
    );
    expect(calls[0]?.url).toContain("profile-subscription-bulk-delete-jobs");
    expect(calls[0]?.body.data.relationships).toBeUndefined();
    expect(calls[1]?.body.data.attributes.metric.data.attributes.name).toBe("Spin won");
    expect(calls[1]?.body.data.attributes.profile.data.attributes.email).toBe("a@b.co");
  });

  it("follows pages of lists but only on Klaviyo's own host", async () => {
    const { calls, fetchFn } = recorder(
      ok({
        data: [{ id: "A", attributes: { name: "Newsletter" } }],
        links: { next: "https://a.klaviyo.com/api/lists?page[cursor]=2" },
      }),
      ok({
        data: [{ id: "B", attributes: { name: "VIP" } }],
        links: { next: "https://evil.test/x" },
      }),
    );
    expect(await EMAIL_TOOLS.klaviyo.lists("pk", fetchFn)).toEqual([
      { id: "A", name: "Newsletter" },
      { id: "B", name: "VIP" },
    ]);
    expect(calls).toHaveLength(2);
  });

  it("marks rate limits as retryable and bad keys as final", async () => {
    const limited = recorder(ok({ errors: [{ detail: "Slow down" }] }, 429));
    await expect(EMAIL_TOOLS.klaviyo.validate("pk", limited.fetchFn)).rejects.toMatchObject({
      retryable: true,
      status: 429,
    });
    const denied = recorder(ok({ errors: [{ detail: "Invalid key" }] }, 401));
    const error = await EMAIL_TOOLS.klaviyo.validate("pk", denied.fetchFn).catch((e) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("Invalid key");
  });
});

describe("mailchimp", () => {
  it("finds the server from the key and rejects anything else", () => {
    expect(mailchimpBase("abc123-us21")).toBe("https://us21.api.mailchimp.com/3.0");
    expect(() => mailchimpBase("abc123-evil.com/x")).toThrow(IntegrationError);
    expect(() => mailchimpBase("no-dash-here!")).toThrow(IntegrationError);
  });

  it("hashes the lowercased email and cleans event names", () => {
    expect(memberHash(" Rahim@Example.com ")).toBe(memberHash("rahim@example.com"));
    expect(memberHash("rahim@example.com")).toMatch(/^[a-f0-9]{32}$/);
    expect(mailchimpEventName("Back in stock requested")).toBe("back_in_stock_requested");
  });

  it("adds a member without forcing the status of an existing one, then tags the source", async () => {
    const { calls, fetchFn } = recorder(ok(), new Response(null, { status: 204 }));
    await EMAIL_TOOLS.mailchimp.subscribe("k-us1", "L1", contact, fetchFn);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe(
      `https://us1.api.mailchimp.com/3.0/lists/L1/members/${memberHash(contact.email)}`,
    );
    expect(calls[0]?.body).toEqual({
      email_address: "rahim@example.com",
      status_if_new: "subscribed",
      merge_fields: { FNAME: "Rahim" },
    });
    expect(calls[1]?.body).toEqual({ tags: [{ name: "spin-wheel", status: "active" }] });
  });

  it("needs an audience and ignores unknown members when unsubscribing", async () => {
    await expect(EMAIL_TOOLS.mailchimp.subscribe("k-us1", null, contact)).rejects.toThrow(
      /audience/,
    );
    const { fetchFn } = recorder(ok({ title: "Resource Not Found" }, 404));
    await expect(
      EMAIL_TOOLS.mailchimp.unsubscribe("k-us1", "L1", "x@y.co", fetchFn),
    ).resolves.toBeUndefined();
  });
});

describe("omnisend", () => {
  it("creates a subscribed contact with a source tag", async () => {
    const { calls, fetchFn } = recorder(ok({}, 201));
    await EMAIL_TOOLS.omnisend.subscribe("key", null, contact, fetchFn);
    expect(calls[0]?.url).toBe("https://api.omnisend.com/api/contacts");
    expect(calls[0]?.headers.Authorization).toBe("Omnisend-API-Key key");
    expect(calls[0]?.body.identifiers[0]).toMatchObject({
      type: "email",
      id: "rahim@example.com",
      channels: { email: { status: "subscribed" } },
    });
    expect(calls[0]?.body.tags).toEqual(["source: spin-wheel"]);
  });

  it("sends custom events", async () => {
    const { calls, fetchFn } = recorder(ok({}, 202));
    await EMAIL_TOOLS.omnisend.event("key", null, { email: "a@b.co", name: "Spin won" }, fetchFn);
    expect(calls[0]?.body).toEqual({
      eventName: "Spin won",
      origin: "api",
      contact: { email: "a@b.co" },
      properties: {},
    });
  });
});
