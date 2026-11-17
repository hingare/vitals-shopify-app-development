import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const {
  deskErrors,
  errorStats,
  flushErrors,
  forgetShopErrors,
  normalize,
  pruneErrors,
  recordError,
  requestLocation,
  requestShop,
  resetErrorLog,
  scrub,
  setErrorResolved,
} = await import("./errors.server");
const { sendErrorAlerts } = await import("./error-alerts.server");
const { registerJob, runJob, enqueueJob } = await import("./queue.server");
const { retryWebhook } = await import("./tool-state.server");

const T0 = new Date("2026-11-17T10:00:00Z");
const seconds = (n: number) => new Date(T0.getTime() + n * 1000);
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

/** সার্ভারের ত্রুটির মতো stack: নিজেদের কোড আর node_modules-এর লাইন */
function serverError(message: string, fn = "loader", line = 120) {
  const error = new TypeError(message);
  error.stack = [
    `TypeError: ${message}`,
    `    at ${fn} (/app/build/server/index.js:${line}:17)`,
    "    at async callLoader (/app/node_modules/react-router/dist/index.js:900:20)",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
  ].join("\n");
  return error;
}

beforeEach(() => {
  resetFakeDb();
  resetErrorLog();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("what goes into the error log", () => {
  it("removes emails, phone numbers, long numbers, tokens and keys", () => {
    const text = scrub(
      [
        "customer ana.b+news@shop-mail.co.uk not found",
        "call +1 (555) 123-4567 or id 7012345678901",
        "token shpat_abc123def456 and sk-ant-api03-XXXXXXXXXXXXXXXX and re_live_123456",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJkZXN0IjoiYSJ9.c2ln",
        "GET https://x.test/cb?code=abc123&state=ok&hmac=deadbeef",
        "postgres://app:hunter2@db.internal:5432/app",
      ].join("\n"),
    );
    expect(text).not.toMatch(/ana\.b|555|7012345678901|shpat_|sk-ant|re_live|hunter2|deadbeef/);
    expect(text).not.toContain("eyJ");
    expect(text).toContain("[email]");
    expect(text).toContain("[phone]");
    expect(text).toContain("code=[secret]&state=ok&hmac=[secret]");
    expect(text).toContain("postgres://[secret]@db.internal");
  });

  it("keeps package versions and short numbers readable", () => {
    expect(scrub("at react-router@7.18.2 line 42, status 503")).toBe(
      "at react-router@7.18.2 line 42, status 503",
    );
  });

  it("ignores ids, numbers and store names when grouping", () => {
    expect(
      normalize("Order 1234 of demo-shop.myshopify.com (cm3abcdefghijklmnopqrstuv) failed"),
    ).toBe(normalize("Order 98 of other.myshopify.com (cm3zyxwvutsrqponmlkjihgfe) failed"));
  });

  it("saves one row with the store, the place and only the code lines of the stack", async () => {
    await recordError(
      {
        source: "server",
        location: "GET /app/offers/:id",
        error: serverError("Cannot read properties of undefined (reading 'map')"),
        shop: "Demo.myshopify.com",
      },
      T0,
    );
    expect(db.appError.rows).toHaveLength(1);
    expect(db.appError.rows[0]).toMatchObject({
      source: "server",
      location: "GET /app/offers/:id",
      name: "TypeError",
      message: "Cannot read properties of undefined (reading 'map')",
      count: 1,
      firstSeenAt: T0,
      lastSeenAt: T0,
      lastShop: "demo.myshopify.com",
      resolvedAt: null,
      notifiedAt: null,
    });
    const stack = db.appError.rows[0]!.stack as string;
    expect(stack.split("\n")[0]).toBe("at loader (/app/build/server/index.js:120:17)");
    expect(stack).not.toContain("TypeError:");
  });

  it("keeps only the call and the reason from a Prisma error, not the query values", async () => {
    const error = new Error(
      [
        "",
        "Invalid `prisma.subscriber.create()` invocation in",
        "/app/build/server/index.js:4410:29",
        "",
        "  4407 const row = await db.subscriber.create({",
        "         data: {",
        '           email: "maria@example.net",',
        '           firstName: "Maria Rossi",',
        "         }",
        "       })",
        "",
        "Unique constraint failed on the fields: (`shopId`,`email`)",
      ].join("\n"),
    );
    error.name = "PrismaClientKnownRequestError";
    await recordError({ source: "job", location: "campaign", error }, T0);
    expect(db.appError.rows[0]!.message).toBe(
      "Invalid `prisma.subscriber.create()` invocation: Unique constraint failed on the fields: (`shopId`,`email`)",
    );
  });

  it("counts the same error with different numbers in one row, and a new place in its own row", async () => {
    const report = (n: number, location = "campaign") => ({
      source: "job" as const,
      location,
      error: serverError(`Campaign ${n} failed after ${n * 3} emails`, "sendBatch", 300 + n),
    });
    await recordError(report(1), seconds(0));
    await recordError(report(2), seconds(20));
    await recordError(report(3, "flow"), seconds(40));
    expect(db.appError.rows).toHaveLength(2);
    expect(db.appError.rows[0]).toMatchObject({
      location: "campaign",
      count: 2,
      firstSeenAt: seconds(0),
      lastSeenAt: seconds(20),
      message: "Campaign 2 failed after 6 emails",
    });
  });

  it("writes a burst of the same error once, then adds the rest of the count", async () => {
    for (let i = 0; i < 5; i++) {
      await recordError(
        { source: "server", location: "GET /app", error: serverError("boom") },
        seconds(i),
      );
    }
    expect(db.appError.rows[0]).toMatchObject({ count: 1, lastSeenAt: seconds(0) });
    await flushErrors(seconds(5));
    expect(db.appError.rows[0]).toMatchObject({ count: 5, lastSeenAt: seconds(4) });
  });

  it("brings a fixed error back to Open, with a new email, when it happens again", async () => {
    await recordError(
      { source: "webhook", location: "customers", error: serverError("db down") },
      T0,
    );
    db.appError.rows[0]!.resolvedAt = seconds(30);
    db.appError.rows[0]!.notifiedAt = seconds(1);
    await recordError(
      { source: "webhook", location: "customers", error: serverError("db down") },
      seconds(60),
    );
    expect(db.appError.rows[0]).toMatchObject({ count: 2, resolvedAt: null, notifiedAt: null });
  });

  it("finds the store from its id, and ignores a store value that isn't a myshopify address", async () => {
    const shopId = db.shop.seed({ domain: "known.myshopify.com" }).id as string;
    await recordError({ source: "job", location: "a", error: new Error("x"), shopId }, T0);
    await recordError(
      { source: "job", location: "b", error: new Error("x"), shop: "evil.com" },
      T0,
    );
    expect(db.appError.rows.map((row) => row.lastShop)).toEqual(["known.myshopify.com", null]);
  });

  it("never throws, even when the database is down", async () => {
    vi.spyOn(db.appError, "upsert").mockRejectedValueOnce(new Error("connection refused"));
    await expect(
      recordError({ source: "server", location: "GET /app", error: new Error("x") }, T0),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("writes at most 60 times a minute from one server", async () => {
    for (let i = 0; i < 70; i++) {
      await recordError(
        { source: "server", location: `GET /p${"x".repeat(i)}`, error: new Error("e") },
        T0,
      );
    }
    expect(db.appError.rows).toHaveLength(60);
    await recordError(
      { source: "server", location: "GET /next", error: new Error("e") },
      seconds(61),
    );
    expect(db.appError.rows).toHaveLength(61);
  });

  it("groups admin page errors by message and page only (browser code names change with every build)", async () => {
    const browserError = (frame: string) => {
      const error = new Error("Cannot read properties of null (reading 'id')");
      error.stack = `Error: x\n    at ${frame} (https://app.test/assets/app.offers-${frame}.js:1:2345)`;
      return error;
    };
    await recordError(
      { source: "admin", location: "/app/offers/:id", error: browserError("Xe") },
      T0,
    );
    await recordError(
      { source: "admin", location: "/app/offers/:id", error: browserError("Qa") },
      seconds(30),
    );
    await recordError(
      { source: "server", location: "GET /x", error: serverError("m", "first") },
      T0,
    );
    await recordError(
      { source: "server", location: "GET /x", error: serverError("m", "second") },
      T0,
    );
    expect(db.appError.rows.map((row) => [row.source, row.count])).toEqual([
      ["admin", 2],
      ["server", 1],
      ["server", 1],
    ]);
  });
});

describe("where an error happened", () => {
  it("names the page by method and path, without ids or React Router's .data", () => {
    const at = (method: string, url: string) =>
      requestLocation(new Request(`https://app.test${url}`, { method }));
    expect(at("GET", "/app/offers/cm3abcdefghijklmnopqrstuv?shop=a")).toBe("GET /app/offers/:id");
    expect(at("POST", "/app/reviews/12345.data")).toBe("POST /app/reviews/:id");
    expect(at("GET", "/_root.data")).toBe("GET /");
    expect(at("GET", "/proxy/reviews/0b8f2c1e-3a4d-4c5b-9e6f-7a8b9c0d1e2f")).toBe(
      "GET /proxy/reviews/:id",
    );
  });

  it("finds the store from the webhook header, the shop parameter or the session token", () => {
    const token = (dest: string) =>
      `x.${Buffer.from(JSON.stringify({ dest })).toString("base64url")}.y`;
    const shop = (url: string, headers: Record<string, string> = {}) =>
      requestShop(new Request(`https://app.test${url}`, { headers }));
    expect(shop("/webhooks/x", { "x-shopify-shop-domain": "hook.myshopify.com" })).toBe(
      "hook.myshopify.com",
    );
    expect(shop("/app?shop=param.myshopify.com")).toBe("param.myshopify.com");
    expect(shop("/app", { authorization: `Bearer ${token("https://tok.myshopify.com")}` })).toBe(
      "tok.myshopify.com",
    );
    expect(shop("/app?shop=evil.com", { authorization: "Bearer not-a-token" })).toBeNull();
  });
});

describe("the support desk's errors page", () => {
  it("lists open errors by last seen and fixed ones apart, with counts", async () => {
    db.appError.seed({ fingerprint: "a", lastSeenAt: seconds(10) });
    db.appError.seed({ fingerprint: "b", lastSeenAt: seconds(20) });
    db.appError.seed({ fingerprint: "c", lastSeenAt: days(-2), resolvedAt: seconds(5) });
    expect((await deskErrors("open")).map((row) => row.fingerprint)).toEqual(["b", "a"]);
    expect((await deskErrors("fixed")).map((row) => row.fingerprint)).toEqual(["c"]);
    expect(await errorStats(seconds(30))).toEqual({ open: 2, lastDay: 2 });
  });

  it("marks an error fixed and reopens it", async () => {
    const id = db.appError.seed({ fingerprint: "a" }).id as string;
    expect(await setErrorResolved(id, true, T0)).toBe(true);
    expect(db.appError.rows[0]!.resolvedAt).toEqual(T0);
    expect(await setErrorResolved(id, false)).toBe(true);
    expect(db.appError.rows[0]!.resolvedAt).toBeNull();
    expect(await setErrorResolved("missing", true)).toBe(false);
  });

  it("deletes errors not seen for 30 days and forgets a deleted store", async () => {
    db.appError.seed({ fingerprint: "old", lastSeenAt: days(-31) });
    db.appError.seed({ fingerprint: "new", lastSeenAt: days(-29), lastShop: "gone.myshopify.com" });
    expect(await pruneErrors(T0)).toBe(1);
    await forgetShopErrors("gone.myshopify.com");
    expect(db.appError.rows).toEqual([
      expect.objectContaining({ fingerprint: "new", lastShop: null }),
    ]);
  });
});

describe("email about new kinds of errors", () => {
  const ENV = {
    EMAIL_FROM: "mail@send.example.org",
    EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_test",
    SUPPORT_INBOX: "owner@inbox.test",
    SUPPORT_DESK_SHOPS: "owner-store.myshopify.com",
    SHOPIFY_API_KEY: "key123",
  };
  const seedError = (fingerprint: string, extra: Record<string, unknown> = {}) =>
    db.appError.seed({
      fingerprint,
      source: "job",
      location: "campaign",
      name: "Error",
      message: `broke ${fingerprint}`,
      firstSeenAt: T0,
      ...extra,
    });

  it("sends the new errors in one email once, with a link to the desk", async () => {
    seedError("a", { lastShop: "demo.myshopify.com", count: 3 });
    seedError("b");
    seedError("c", { resolvedAt: T0 });
    const send = vi.fn().mockResolvedValue({ ok: true });
    expect(await sendErrorAlerts(T0, ENV, send)).toEqual({ sent: 2 });
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0]![0] as { to: string; subject: string; text: string };
    expect(mail.to).toBe("owner@inbox.test");
    expect(mail.subject).toContain("2");
    expect(mail.text).toContain("Error: broke a");
    expect(mail.text).toContain("Background job · campaign · 3× · demo.myshopify.com");
    expect(mail.text).not.toContain("broke c");
    expect(mail.text).toContain(
      "https://admin.shopify.com/store/owner-store/apps/key123/app/desk/errors",
    );
    expect(db.appError.rows.map((row) => row.notifiedAt)).toEqual([T0, T0, null]);
    expect(await sendErrorAlerts(seconds(600), ENV, send)).toEqual({ sent: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when email or the inbox isn't set up", async () => {
    seedError("a");
    const send = vi.fn();
    expect(await sendErrorAlerts(T0, { ...ENV, SUPPORT_INBOX: "" }, send)).toEqual({ sent: 0 });
    expect(await sendErrorAlerts(T0, { ...ENV, EMAIL_PROVIDER: "" }, send)).toEqual({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(db.appError.rows[0]!.notifiedAt).toBeNull();
  });

  it("tries again after a temporary failure, but not after a permanent one", async () => {
    seedError("a");
    const send = vi.fn().mockResolvedValueOnce({ ok: false, error: "503" });
    await sendErrorAlerts(T0, ENV, send);
    expect(db.appError.rows[0]!.notifiedAt).toBeNull();
    send.mockResolvedValueOnce({ ok: false, error: "invalid key", permanent: true });
    await sendErrorAlerts(seconds(600), ENV, send);
    expect(db.appError.rows[0]!.notifiedAt).toEqual(seconds(600));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("stops at 100 errors a day and says how many more are waiting", async () => {
    for (let i = 0; i < 95; i++) seedError(`old${i}`, { notifiedAt: seconds(-3600) });
    for (let i = 0; i < 8; i++) seedError(`new${i}`);
    const send = vi.fn().mockResolvedValue({ ok: true });
    expect(await sendErrorAlerts(T0, ENV, send)).toEqual({ sent: 5 });
    expect((send.mock.calls[0]![0] as { text: string }).text).toContain(
      "3 more are waiting in the support desk.",
    );
    expect(await sendErrorAlerts(seconds(600), ENV, send)).toEqual({ sent: 0 });
  });
});

describe("where errors come from", () => {
  it("logs a background job only when its last try fails, with the job's kind and store", async () => {
    const shopId = db.shop.seed({ domain: "jobs.myshopify.com" }).id as string;
    registerJob("sync", async () => {
      throw new Error("Klaviyo answered 500");
    });
    const job = await enqueueJob(shopId, "sync:list-9");
    const run = (attempts: number) =>
      runJob({ id: job.id, shopId, kind: "sync:list-9", payload: {}, attempts });
    await run(1);
    expect(db.appError.rows).toHaveLength(0);
    await run(3);
    expect(db.appError.rows[0]).toMatchObject({
      source: "job",
      location: "sync",
      message: "Klaviyo answered 500",
      lastShop: "jobs.myshopify.com",
    });
  });

  it("logs a failed webhook and still asks Shopify to send it again", async () => {
    const response = retryWebhook("customers", new Error("deadlock"), "hook.myshopify.com");
    expect(response.status).toBe(503);
    await vi.waitFor(() => expect(db.appError.rows).toHaveLength(1));
    expect(db.appError.rows[0]).toMatchObject({
      source: "webhook",
      location: "customers",
      lastShop: "hook.myshopify.com",
    });
  });
});

describe("errors from the admin in the browser", () => {
  it("sends only our own code's errors, each once, at most five per page", async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("window", {
      location: { origin: "https://app.test", pathname: "/app/offers/12" },
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { reportClientError } = await import("./errors");
      const ours = (message: string) => {
        const error = new Error(message);
        error.stack = `Error: ${message}\n    at x (https://app.test/assets/app-1a2b.js:1:2)`;
        return error;
      };
      const cdn = new Error("cdn");
      cdn.stack = "Error: cdn\n    at y (https://cdn.shopify.com/shopifycloud/app-bridge.js:1:2)";
      const server = ours("Unexpected Server Error");
      reportClientError(cdn);
      reportClientError(server);
      reportClientError("not an error");
      const first = ours("one");
      reportClientError(first);
      reportClientError(first);
      for (let i = 0; i < 6; i++) reportClientError(ours(`n${i}`));

      expect(fetchMock).toHaveBeenCalledTimes(5);
      const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
      expect(url).toBe("/app/errors");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toMatchObject({
        name: "Error",
        message: "one",
        path: "/app/offers/12",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
