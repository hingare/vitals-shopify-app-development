import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FalError,
  falAiError,
  falCancel,
  falConfigured,
  falResult,
  falStatus,
  falSubmit,
  isFreeFailure,
  setFalFetchForTests,
} from "./fal.server";

type Sent = { url: string; method: string; headers: Headers; body: string };
let sent: Sent[];
let reply: (req: Sent) => Response | Promise<Response>;
const savedKey = process.env.FAL_KEY;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const QUEUED = {
  request_id: "req-1",
  status_url: "https://queue.fal.run/fal-ai/bria/requests/req-1/status",
  response_url: "https://queue.fal.run/fal-ai/bria/requests/req-1",
  cancel_url: "https://queue.fal.run/fal-ai/bria/requests/req-1/cancel",
};

beforeEach(() => {
  process.env.FAL_KEY = "fal-test-key";
  sent = [];
  reply = () => json(QUEUED);
  setFalFetchForTests(async (input, init) => {
    const req = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    };
    sent.push(req);
    return reply(req);
  });
});

afterEach(() => {
  setFalFetchForTests(null);
  if (savedKey === undefined) delete process.env.FAL_KEY;
  else process.env.FAL_KEY = savedKey;
});

describe("fal queue client", () => {
  it("submits with the key, asks fal to drop its copy after a day, and keeps the returned addresses", async () => {
    const request = await falSubmit("fal-ai/bria/background/remove", { image_url: "https://x" });
    expect(request).toEqual({
      requestId: "req-1",
      statusUrl: QUEUED.status_url,
      responseUrl: QUEUED.response_url,
      cancelUrl: QUEUED.cancel_url,
    });
    const [req] = sent;
    expect(req?.url).toBe("https://queue.fal.run/fal-ai/bria/background/remove");
    expect(req?.method).toBe("POST");
    expect(req?.headers.get("authorization")).toBe("Key fal-test-key");
    expect(JSON.parse(req?.headers.get("x-fal-object-lifecycle-preference") ?? "{}")).toEqual({
      expiration_duration_seconds: 86_400,
    });
    expect(JSON.parse(req?.body ?? "{}")).toEqual({ image_url: "https://x" });
  });

  it("treats a refused submit as certain, but a strange answer or a dropped line as uncertain", async () => {
    reply = () => json({ detail: [{ msg: "image_url is required" }] }, 422);
    const refused = await falSubmit("m", {}).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(FalError);
    expect(refused).toMatchObject({ status: 422, rejected: true });

    reply = () => json({ ...QUEUED, status_url: "https://evil.example.com/status" });
    expect(await falSubmit("m", {}).catch((e: unknown) => e)).toMatchObject({ rejected: false });

    reply = () => {
      throw new TypeError("fetch failed", { cause: { code: "UND_ERR_SOCKET" } });
    };
    expect(await falSubmit("m", {}).catch((e: unknown) => e)).toMatchObject({
      status: null,
      rejected: false,
    });

    // সংযোগই হয়নি: অনুরোধ fal-এ পৌঁছায়নি
    reply = () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    };
    expect(await falSubmit("m", {}).catch((e: unknown) => e)).toMatchObject({ rejected: true });
  });

  it("reads waiting, finished and failed states", async () => {
    reply = () => json({ status: "IN_QUEUE", queue_position: 3 });
    expect(await falStatus(QUEUED.status_url)).toEqual({ state: "waiting", position: 3 });
    reply = () => json({ status: "IN_PROGRESS" });
    expect(await falStatus(QUEUED.status_url)).toEqual({ state: "waiting", position: null });
    reply = () => json({ status: "COMPLETED" });
    expect(await falStatus(QUEUED.status_url)).toEqual({
      state: "done",
      error: null,
      errorType: null,
    });
    reply = () =>
      json({ status: "COMPLETED", error: "Runner crashed", error_type: "runner_server_error" });
    expect(await falStatus(QUEUED.status_url)).toEqual({
      state: "done",
      error: "Runner crashed",
      errorType: "runner_server_error",
    });
    reply = () => json({ image: { url: "https://v3.fal.media/files/a/out.png" } });
    expect(await falResult(QUEUED.response_url)).toEqual({
      image: { url: "https://v3.fal.media/files/a/out.png" },
    });
  });

  it("knows when a cancel stopped the work before it started", async () => {
    reply = () => json({ status: "OK" });
    expect(await falCancel(QUEUED.cancel_url)).toBe("removed");
    expect(sent.at(-1)?.method).toBe("PUT");
    reply = () => json({ status: "CANCELLATION_REQUESTED" }, 202);
    expect(await falCancel(QUEUED.cancel_url)).toBe("requested");
    reply = () => json({ status: "ALREADY_COMPLETED" }, 400);
    expect(await falCancel(QUEUED.cancel_url)).toBe("finished");
    reply = () => new Response("oops", { status: 500 });
    expect(await falCancel(QUEUED.cancel_url)).toBe("unknown");
  });

  it("turns fal errors into the merchant's error kinds", () => {
    expect(falAiError(new FalError("bad key", 401, true)).code).toBe("not_configured");
    expect(falAiError(new FalError("slow", null, false)).code).toBe("busy");
    expect(falAiError(new FalError("rate", 429, true)).code).toBe("busy");
    expect(falAiError(new FalError("down", 503, true)).code).toBe("busy");
    expect(falAiError(new FalError("NSFW content detected", 422, true)).code).toBe("refused");
    expect(falAiError(new FalError("gone", 404, true)).code).toBe("not_found");
    expect(falAiError(new FalError("bad input", 422, true)).code).toBe("failed");
    expect(falAiError(new Error("boom")).code).toBe("failed");
    expect(isFreeFailure("runner_server_error")).toBe(true);
    expect(isFreeFailure("validation_error")).toBe(false);
    expect(isFreeFailure(null)).toBe(false);
  });

  it("is off without a key", async () => {
    setFalFetchForTests(null);
    delete process.env.FAL_KEY;
    expect(falConfigured()).toBe(false);
    await expect(falSubmit("m", {})).rejects.toMatchObject({ code: "not_configured" });
    process.env.FAL_KEY = "k";
    expect(falConfigured()).toBe(true);
  });
});
