import { describe, expect, it, vi } from "vitest";
import {
  EMAIL_TOOLS,
  IntegrationError,
  buildCustomUrl,
  isPrivateAddress,
  mailchimpBase,
  mailchimpEventName,
  memberHash,
  normalizePhone,
  sendSms,
  smsSegments,
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

describe("normalizePhone", () => {
  it("accepts the ways Bangladeshi numbers are written", () => {
    for (const raw of [
      "01712345678",
      "+8801712345678",
      "8801712345678",
      "008801712345678",
      "017-1234 5678",
      "০১৭১২৩৪৫৬৭৮",
    ]) {
      expect(normalizePhone(raw, "BD")).toBe("8801712345678");
    }
  });
  it("rejects wrong operators, lengths and letters", () => {
    expect(normalizePhone("01212345678", "BD")).toBeNull();
    expect(normalizePhone("0171234567", "BD")).toBeNull();
    expect(normalizePhone("0171234567a", "BD")).toBeNull();
    expect(normalizePhone(undefined, "BD")).toBeNull();
  });
  it("keeps other countries as digits with the country code", () => {
    expect(normalizePhone("+91 98765 43210", "IN")).toBe("919876543210");
    expect(normalizePhone("123", "IN")).toBeNull();
  });
});

describe("smsSegments", () => {
  it("counts 160 for plain text and 70 for Bangla", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("আ".repeat(70))).toBe(1);
    expect(smsSegments("আ".repeat(71))).toBe(2);
  });
});

describe("sendSms", () => {
  it("alpha-sms: success is error 0", async () => {
    const { calls, fetchFn } = recorder(ok({ error: 0, msg: "ok", data: { request_id: 77 } }));
    const result = await sendSms(
      { gateway: "alpha-sms", apiKey: "K", senderId: "SHOP" },
      "8801712345678",
      "Hi",
      { fetchFn },
    );
    expect(result).toEqual({ ok: true, id: "77" });
    expect(calls[0]?.url).toBe("https://api.sms.net.bd/sendsms");
    expect(String(calls[0]?.body)).toBe("api_key=K&msg=Hi&to=8801712345678&sender_id=SHOP");
  });

  it("alpha-sms: reports the gateway's error and does not retry low balance", async () => {
    const { fetchFn } = recorder(ok({ error: 417, msg: "Insufficient balance" }));
    expect(
      await sendSms({ gateway: "alpha-sms", apiKey: "K" }, "8801712345678", "Hi", { fetchFn }),
    ).toEqual({ ok: false, error: "417 Insufficient balance", permanent: true });
  });

  it("ssl-wireless and bulksmsbd read their own success fields", async () => {
    const ssl = recorder(ok({ status: "SUCCESS", smsinfo: [{ sms_id: "A1" }] }));
    expect(
      await sendSms(
        { gateway: "ssl-wireless", apiKey: "T", senderId: "SID" },
        "8801712345678",
        "Hi",
        {
          fetchFn: ssl.fetchFn,
        },
      ),
    ).toEqual({ ok: true, id: "A1" });
    expect(ssl.calls[0]?.body).toMatchObject({
      api_token: "T",
      sid: "SID",
      msisdn: "8801712345678",
    });

    const bulk = recorder(ok({ response_code: 1007, error_message: "Balance Insufficient" }));
    expect(
      await sendSms({ gateway: "bulksmsbd", apiKey: "T" }, "8801712345678", "Hi", {
        fetchFn: bulk.fetchFn,
      }),
    ).toMatchObject({ ok: false, error: "1007 Balance Insufficient" });
  });

  it("network failures can be retried", async () => {
    const fetchFn = (async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    expect(
      await sendSms({ gateway: "alpha-sms", apiKey: "K" }, "8801712345678", "Hi", { fetchFn }),
    ).toEqual({ ok: false, error: "socket hang up" });
  });
});

describe("custom gateway", () => {
  const config = {
    gateway: "custom" as const,
    apiKey: "K&1",
    senderId: "S",
    customUrl: "https://sms.example.com/send?key={api_key}&to={to}&text={message}",
    customSuccess: "OK",
  };

  it("fills the link and escapes values", () => {
    expect(buildCustomUrl(config, "8801712345678", "Hi there & more")?.toString()).toBe(
      "https://sms.example.com/send?key=K%261&to=8801712345678&text=Hi%20there%20%26%20more",
    );
    expect(
      buildCustomUrl({ ...config, customUrl: "http://sms.example.com/?t={to}" }, "1", "x"),
    ).toBeNull();
    expect(
      buildCustomUrl({ ...config, customUrl: "https://u:p@sms.example.com/" }, "1", "x"),
    ).toBeNull();
  });

  it("knows private and local addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });

  it("refuses hosts that resolve to a private address and never calls them", async () => {
    const get = vi.fn();
    const result = await sendSms(config, "8801712345678", "Hi", {
      get,
      resolve: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    });
    expect(result).toMatchObject({ ok: false, permanent: true });
    expect(get).not.toHaveBeenCalled();
  });

  it("calls the checked address and looks for the success text", async () => {
    const get = vi.fn(async (_url: URL, _address: string, _family: number) => ({
      status: 200,
      body: "OK id=5",
    }));
    const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
    expect(await sendSms(config, "8801712345678", "Hi", { get, resolve })).toEqual({ ok: true });
    expect(get.mock.calls[0]?.[1]).toBe("93.184.216.34");
    get.mockResolvedValueOnce({ status: 200, body: "ERROR bad key" });
    expect(await sendSms(config, "8801712345678", "Hi", { get, resolve })).toMatchObject({
      ok: false,
    });
  });
});
