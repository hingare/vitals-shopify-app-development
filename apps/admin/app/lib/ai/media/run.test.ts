import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** নকল Shopify অ্যাডমিন (কাজের লাইন offlineAdmin দিয়ে এটাই পায়) */
const shopify = vi.hoisted(() => ({ admin: null as unknown }));

vi.mock("../../../db.server", async () => ({ default: (await import("../../test-db")).fakeDb }));
vi.mock("../../admin-client.server", async (original) => ({
  ...(await original<typeof import("../../admin-client.server")>()),
  offlineAdmin: async () => shopify.admin,
}));
const { fakeDb: db, resetFakeDb } = await import("../../test-db");
const { setAiClientForTests } = await import("../claude.server");
const { discardGeneration, runGenerationJob } = await import("../generations.server");
const { handleToolAction } = await import("../tool-page.server");
const { getObject } = await import("../../object-store.server");
const { setFalFetchForTests } = await import("./fal.server");
const { setMediaFetchForTests } = await import("./files.server");
const { setUploadFetchForTests } = await import("./shopify-media.server");
const { settleMedia } = await import("./run.server");
const { JPEG, MP4, PNG } = await import("./test-files");
await import("../tasks.server");

const PRODUCT = "gid://shopify/Product/1";
const IMG = (n: number) => `gid://shopify/MediaImage/${n}`;
const MONTH = new Date().toISOString().slice(0, 7);

// ---- নকল Shopify ----
let productMedia: string[];
let nextMedia: number;
let gqlCalls: Array<{ name: string; variables: Record<string, unknown> }>;
const admin = {
  graphql: vi.fn(async (query: string, options?: { variables?: Record<string, unknown> }) => {
    const variables = options?.variables ?? {};
    const name = /(?:query|mutation) (\w+)/.exec(query)?.[1] ?? "";
    gqlCalls.push({ name, variables });
    let data: unknown;
    switch (name) {
      case "AiProduct":
        data = {
          product: {
            id: PRODUCT,
            title: "Linen Shirt",
            handle: "linen-shirt",
            vendor: "Acme",
            productType: "Shirt",
            tags: [],
            descriptionHtml: "<p>Soft linen.</p>",
            seo: { title: null, description: null },
            options: [],
            priceRangeV2: null,
            media: {
              nodes: [
                {
                  id: IMG(1),
                  alt: "Blue linen shirt",
                  image: { url: "https://cdn.shopify.com/s/shirt.jpg", width: 3000, height: 2000 },
                },
                {
                  id: IMG(2),
                  alt: "",
                  image: { url: "https://cdn.shopify.com/s/back.jpg", width: 800, height: 800 },
                },
              ],
            },
          },
        };
        break;
      case "AiProductMediaIds":
        data = { product: { media: { nodes: productMedia.map((id) => ({ id })) } } };
        break;
      case "AiStagedUpload": {
        const [input] = variables.input as Array<{ filename: string }>;
        data = {
          stagedUploadsCreate: {
            stagedTargets: [
              {
                url: "https://shopify-staged-uploads.storage.googleapis.com/",
                resourceUrl: `https://shopify-staged-uploads.storage.googleapis.com/tmp/${input!.filename}`,
                parameters: [{ name: "key", value: `tmp/${input!.filename}` }],
              },
            ],
            userErrors: [],
          },
        };
        break;
      }
      case "AiAddProductMedia":
        for (let i = 0; i < (variables.media as unknown[]).length; i++) {
          productMedia.push(IMG(nextMedia++));
        }
        data = {
          productUpdate: {
            product: { media: { nodes: productMedia.map((id) => ({ id })) } },
            userErrors: [],
          },
        };
        break;
      case "AiDeleteMedia": {
        const ids = variables.fileIds as string[];
        productMedia = productMedia.filter((id) => !ids.includes(id));
        data = { fileDelete: { deletedFileIds: ids, userErrors: [] } };
        break;
      }
      default:
        throw new Error(`Unexpected query ${name}`);
    }
    return new Response(JSON.stringify({ data }));
  }),
};
shopify.admin = admin;

// ---- নকল fal ----
type FalCall = { url: string; method: string; body: Record<string, unknown> | null };
let falCalls: FalCall[];
let seq: number;
let submitReply: () => Response;
let statusReplies: Array<() => Response>;
let resultReply: () => Response;
let cancelReply: () => Response;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const queued = () => {
  const id = `req-${++seq}`;
  const base = `https://queue.fal.run/fal-ai/model/requests/${id}`;
  return json({
    request_id: id,
    status_url: `${base}/status`,
    response_url: base,
    cancel_url: `${base}/cancel`,
  });
};
const completed = () => json({ status: "COMPLETED" });
const waiting = () => json({ status: "IN_QUEUE", queue_position: 2 });

// ---- নকল ফাইল নামানো আর Shopify-তে আপলোড ----
let uploads: Array<{ url: string; file: File | null }>;

let dir: string;
let shop: { id: string; domain: string; plan: string; trialEndsAt: Date | null };

beforeEach(() => {
  resetFakeDb();
  dir = mkdtempSync(join(tmpdir(), "ai-run-"));
  process.env.OBJECT_STORE_DIR = dir;
  productMedia = [IMG(1), IMG(2)];
  nextMedia = 100;
  gqlCalls = [];
  falCalls = [];
  seq = 0;
  uploads = [];
  submitReply = queued;
  statusReplies = [];
  resultReply = () => json({ image: { url: "https://v3.fal.media/files/a/out.png" } });
  cancelReply = () => json({ status: "OK" });
  setFalFetchForTests(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as FalCall["body"]) : null;
    falCalls.push({ url, method, body });
    if (method === "POST") return submitReply();
    if (method === "PUT") return cancelReply();
    if (url.endsWith("/status")) return (statusReplies.shift() ?? completed)();
    return resultReply();
  });
  setMediaFetchForTests(async (input) => {
    const url = String(input);
    const body = url.endsWith(".mp4") ? MP4 : url.endsWith(".jpg") ? JPEG : PNG;
    return new Response(new Uint8Array(body));
  });
  setUploadFetchForTests(async (input, init) => {
    const form = init?.body as FormData;
    uploads.push({ url: String(input), file: form.get("file") as File | null });
    return new Response(null, { status: 201 });
  });
  const row = db.shop.seed({
    domain: "a.myshopify.com",
    plan: "professional",
    uninstalledAt: null,
  });
  shop = {
    id: row.id as string,
    domain: "a.myshopify.com",
    plan: "professional",
    trialEndsAt: null,
  };
});

afterEach(() => {
  setFalFetchForTests(null);
  setMediaFetchForTests(null);
  setUploadFetchForTests(null);
  setAiClientForTests(null);
  delete process.env.OBJECT_STORE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const used = () => (db.usageCounter.rows.find((r) => r.shopId === shop.id)?.used as number) ?? 0;
const generation = (index = 0) => db.aiGeneration.rows[index]!;
const start = (toolId: string, input: Record<string, unknown>) =>
  handleToolAction(shop, admin, toolId, {
    intent: "start",
    input: { productId: PRODUCT, ...input },
  });

/** একটা কাজের এক পালা: লাইনের কাজটা চালিয়ে পরের পালার কাজ (থাকলে) ফেরত দেয় */
function jobOf(generationId: string) {
  const row = db.job.rows.find(
    (job) => (job.payload as { generationId?: string }).generationId === generationId,
  )!;
  let payload = row.payload as Record<string, unknown>;
  return {
    async round(attempts = 1) {
      const result = await runGenerationJob({
        id: row.id as string,
        shopId: row.shopId as string,
        kind: row.kind as string,
        payload,
        attempts,
      });
      if (result && result.again && result.payload) {
        payload = result.payload;
        return result.delayMs ?? 0;
      }
      return null;
    },
    get pending() {
      return payload.pending as Record<string, unknown> | undefined;
    },
  };
}

describe("AI Background Remover from start to undo", () => {
  it("makes one task per chosen photo, holds the credits at submit and checks back without blocking", async () => {
    expect(
      await start("ai-background-remover", { mediaIds: [IMG(1), IMG(2)], background: "white" }),
    ).toEqual({ ok: true, intent: "start", count: 2, failed: 0 });
    expect(db.aiGeneration.rows.map((r) => r.label)).toEqual([
      "Linen Shirt · #1",
      "Linen Shirt · #2",
    ]);
    expect(new Set(db.aiGeneration.rows.map((r) => r.batchId)).size).toBe(1);
    expect(generation().input).toMatchObject({
      mediaId: IMG(1),
      imageUrl: "https://cdn.shopify.com/s/shirt.jpg?width=240",
    });

    const job = jobOf(generation().id as string);
    statusReplies = [waiting];
    // ১: জমা (ছবির লম্বা দিক ২০৪৮-এ নামানো), ক্রেডিট আগেই ধরা
    expect(await job.round()).toBe(4_000);
    expect(falCalls[0]).toMatchObject({
      url: "https://queue.fal.run/fal-ai/bria/background/remove",
      method: "POST",
      body: { image_url: "https://cdn.shopify.com/s/shirt.jpg?width=2048" },
    });
    expect(used()).toBe(18_000);
    expect(generation().status).toBe("running");
    // ২: এখনো লাইনে
    expect(await job.round()).toBe(4_000);
    expect(job.pending).toMatchObject({ step: "remote", polls: 1 });
    // ৩: শেষ: ফাইল আমাদের স্টোরেজে, সাদা পটভূমিতে
    expect(await job.round()).toBeNull();
    const key = `ai-media/${shop.id}/${generation().id as string}/0.png`;
    expect(generation()).toMatchObject({
      status: "ready",
      costMicros: 18_000,
      model: "fal-ai/bria/background/remove",
      mediaKeys: [key],
      output: { files: [{ key, type: "image", mime: "image/png" }], selected: [0] },
    });
    expect((await getObject(key))?.[25]).toBe(2);
    expect(used()).toBe(18_000);
  });

  it("adds the result to the product as new media, then undo removes only that", async () => {
    await start("ai-background-remover", { mediaIds: [IMG(1)] });
    const id = generation().id as string;
    const job = jobOf(id);
    await job.round();
    await job.round();
    expect(generation().status).toBe("ready");

    expect(
      await handleToolAction(shop, admin, "ai-background-remover", { intent: "apply", id }),
    ).toMatchObject({
      ok: true,
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.file?.type).toBe("image/png");
    expect(uploads[0]?.file?.name).toBe("linen-shirt-ai-1.png");
    const staged = gqlCalls.find((c) => c.name === "AiStagedUpload")!.variables.input as unknown[];
    expect(staged[0]).toMatchObject({
      resource: "IMAGE",
      mimeType: "image/png",
      httpMethod: "POST",
    });
    const added = gqlCalls.find((c) => c.name === "AiAddProductMedia")!.variables;
    expect(added).toMatchObject({
      product: { id: PRODUCT },
      media: [{ mediaContentType: "IMAGE", alt: "Blue linen shirt" }],
    });
    expect(productMedia).toEqual([IMG(1), IMG(2), IMG(100)]);
    expect(generation()).toMatchObject({
      status: "applied",
      previous: { productId: PRODUCT, mediaIds: [IMG(100)] },
    });

    expect(
      await handleToolAction(shop, admin, "ai-background-remover", { intent: "undo", id }),
    ).toMatchObject({
      ok: true,
    });
    expect(productMedia).toEqual([IMG(1), IMG(2)]);
    expect(generation().status).toBe("undone");
  });

  it("deletes the stored files when the merchant discards the result", async () => {
    await start("ai-background-remover", { mediaIds: [IMG(2)] });
    const id = generation().id as string;
    const job = jobOf(id);
    await job.round();
    await job.round();
    const key = (generation().mediaKeys as string[])[0]!;
    expect(await getObject(key)).not.toBeNull();
    await discardGeneration(shop, id);
    expect(await getObject(key)).toBeNull();
    expect(generation()).toMatchObject({ status: "discarded", mediaKeys: [] });
  });
});

describe("credits are never lost or overspent", () => {
  it("gives the credits back when fal refuses the request, but keeps them when the line drops", async () => {
    await start("ai-background-remover", { mediaIds: [IMG(1)] });
    submitReply = () => json({ detail: "image_url could not be read" }, 422);
    expect(await jobOf(generation().id as string).round()).toBeNull();
    expect(generation()).toMatchObject({ status: "failed", error: "failed" });
    expect(used()).toBe(0);

    await start("ai-background-remover", { mediaIds: [IMG(2)] });
    submitReply = () => {
      throw new TypeError("fetch failed", { cause: { code: "UND_ERR_SOCKET" } });
    };
    // fal নিয়েছে কিনা জানা নেই: ক্রেডিট ধরা থাকে, লাইন পরে আবার চেষ্টা করে
    await expect(jobOf(generation(1).id as string).round()).rejects.toMatchObject({ code: "busy" });
    expect(used()).toBe(18_000);
  });

  it("cancels a request still waiting at fal when the task finally gives up, and refunds it", async () => {
    await start("ai-background-remover", { mediaIds: [IMG(2)] });
    const job = jobOf(generation().id as string);
    await job.round();
    expect(used()).toBe(18_000);
    statusReplies = [() => new Response("down", { status: 503 }), waiting];
    expect(await job.round(3)).toBeNull();
    expect(generation()).toMatchObject({ status: "failed", error: "busy" });
    expect(falCalls.at(-1)).toMatchObject({ method: "PUT" });
    expect(used()).toBe(0);
  });

  it("refunds fal's own server failures, but not a model's answer or work that already ran", async () => {
    await start("ai-background-remover", { mediaIds: [IMG(2)] });
    const job = jobOf(generation().id as string);
    await job.round();
    const failure = () =>
      json({ status: "COMPLETED", error: "Runner crashed", error_type: "runner_server_error" });
    statusReplies = [failure, failure];
    expect(await job.round()).toBeNull();
    expect(generation()).toMatchObject({ status: "failed", error: "failed" });
    expect(used()).toBe(0);

    const pending = (extra: Record<string, unknown> = {}) => ({
      ...(job.pending ?? {}),
      step: "remote",
      reserved: 18_000,
      month: MONTH,
      ...extra,
    });
    db.usageCounter.rows[0]!.used = 18_000;
    statusReplies = [
      () => json({ status: "COMPLETED", error: "NSFW content", error_type: "content_policy" }),
    ];
    await settleMedia(shop, pending());
    expect(used()).toBe(18_000);
    statusReplies = [completed];
    await settleMedia(shop, pending());
    expect(used()).toBe(18_000);
    statusReplies = [() => json({ status: "IN_PROGRESS" })];
    cancelReply = () => json({ status: "CANCELLATION_REQUESTED" }, 202);
    await settleMedia(shop, pending());
    expect(used()).toBe(18_000);
  });

  it("does not start when the month's credits can't cover the price, or fal is not set up", async () => {
    db.usageCounter.seed({ shopId: shop.id, meter: "ai", month: MONTH, used: 2_800_000 });
    expect(await start("ai-image-to-video", { mediaIds: [IMG(1)], length: "short" })).toEqual({
      ok: false,
      intent: "start",
      error: "budget",
    });
    db.usageCounter.rows[0]!.used = 0;
    setFalFetchForTests(null);
    const key = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    expect(await start("ai-background-remover", { mediaIds: [IMG(1)] })).toMatchObject({
      ok: false,
      error: "not_configured",
    });
    if (key !== undefined) process.env.FAL_KEY = key;
    expect(db.aiGeneration.rows).toHaveLength(0);
  });
});

describe("AI Image Enhancer and AI Photoshoots", () => {
  it("refuses work that changes nothing, and extends a square photo to a wide one", async () => {
    expect(await start("ai-image-enhancer", { mediaIds: [IMG(1)], mode: "upscale" })).toMatchObject(
      {
        ok: false,
        error: "invalid",
      },
    );
    expect(
      await start("ai-image-enhancer", { mediaIds: [IMG(2)], mode: "expand", shape: "1:1" }),
    ).toMatchObject({ ok: false, error: "invalid" });
    expect(
      await start("ai-image-enhancer", { mediaIds: [IMG(1), IMG(2)], mode: "expand" }),
    ).toMatchObject({ ok: false, error: "invalid" });
    expect(
      await start("ai-image-enhancer", { mediaIds: [IMG(2)], mode: "expand", shape: "16:9" }),
    ).toMatchObject({ ok: true, count: 1 });
    await jobOf(generation().id as string).round();
    expect(falCalls[0]).toMatchObject({
      url: "https://queue.fal.run/fal-ai/bria/expand",
      body: {
        canvas_size: [1422, 800],
        original_image_size: [800, 800],
        original_image_location: [311, 0],
      },
    });
    expect(used()).toBe(40_000);
  });

  it("adds only the photos the merchant chose, and refuses files of another task", async () => {
    expect(
      await start("ai-photoshoots", { mediaIds: [IMG(2)], scene: "kitchen", count: 3 }),
    ).toMatchObject({ ok: true, count: 1 });
    resultReply = () =>
      json({
        images: [1, 2, 3].map((n) => ({ url: `https://v3.fal.media/files/s/${n}.jpg` })),
      });
    const id = generation().id as string;
    const job = jobOf(id);
    await job.round();
    expect(falCalls[0]?.body).toMatchObject({
      num_results: 3,
      scene_description: expect.stringContaining("kitchen"),
    });
    expect(used()).toBe(120_000);
    await job.round();
    const output = generation().output as { files: Array<{ key: string }>; selected: number[] };
    expect(output.files).toHaveLength(3);
    expect(output.files.map((f) => f.key)).toEqual(
      [0, 1, 2].map((n) => `ai-media/${shop.id}/${id}/${n}.jpg`),
    );

    const foreign = {
      ...output,
      files: output.files.map((file, index) =>
        index === 1 ? { ...file, key: `ai-media/${shop.id}/someothertask/1.jpg` } : file,
      ),
    };
    expect(
      await handleToolAction(shop, admin, "ai-photoshoots", {
        intent: "apply",
        id,
        output: foreign,
      }),
    ).toMatchObject({ ok: false, error: "invalid" });
    expect(
      await handleToolAction(shop, admin, "ai-photoshoots", {
        intent: "apply",
        id,
        output: { ...output, selected: [] },
      }),
    ).toMatchObject({ ok: false, error: "invalid" });
    expect(uploads).toHaveLength(0);

    expect(
      await handleToolAction(shop, admin, "ai-photoshoots", {
        intent: "apply",
        id,
        output: { ...output, selected: [0, 2] },
      }),
    ).toMatchObject({ ok: true });
    expect(uploads.map((u) => u.file?.type)).toEqual(["image/jpeg", "image/jpeg"]);
    const added = gqlCalls.find((c) => c.name === "AiAddProductMedia")!.variables
      .media as unknown[];
    // উৎসের ছবির alt নেই, তাই প্রোডাক্টের নাম
    expect(added).toEqual([
      expect.objectContaining({ alt: "Linen Shirt" }),
      expect.objectContaining({ alt: "Linen Shirt" }),
    ]);
    expect(generation()).toMatchObject({ status: "applied", output: { selected: [0, 2] } });
  });
});

describe("AI Video Ads", () => {
  it("writes the ad text once, survives a failed submit, and makes the video", async () => {
    const stream = vi.fn(() => {
      const message = {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              motion: "Slow camera orbit around the shirt on a wooden table.",
              hook: "Summer starts here",
              headline: "Linen that breathes",
              primaryText: "Light, soft and made to last.",
              cta: "shop_now",
              hashtags: ["#linen", "summer", ""],
            }),
            citations: null,
          },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 3_000, output_tokens: 400, iterations: null },
      } as unknown as BetaMessage;
      return { finalMessage: () => Promise.resolve(message) };
    });
    setAiClientForTests({ beta: { messages: { stream } } } as never);

    expect(
      await start("ai-video-ads", {
        mediaIds: [IMG(1)],
        platform: "tiktok",
        goal: "launch",
        length: "short",
      }),
    ).toMatchObject({ ok: true, count: 1 });
    const job = jobOf(generation().id as string);

    // ১: লেখা তৈরি, খরচ লেখা হলো, তারপর সাথে সাথে জমার পালা
    expect(await job.round()).toBe(0);
    expect(stream).toHaveBeenCalledTimes(1);
    const writing = generation().costMicros as number;
    expect(writing).toBeGreaterThan(0);
    expect(used()).toBe(writing);
    expect(job.pending).toMatchObject({ step: "submit" });

    // ২: fal ব্যস্ত: ধরা ক্রেডিট ফেরত, লাইন একই অবস্থা থেকে আবার চালায় (লেখা আবার হয় না)
    submitReply = () => new Response("busy", { status: 503 });
    await expect(job.round()).rejects.toMatchObject({ code: "busy" });
    expect(used()).toBe(writing);
    submitReply = queued;
    expect(await job.round()).toBe(30_000);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(used()).toBe(writing + 280_000);
    const submitted = falCalls.filter((c) => c.method === "POST").at(-1)!;
    expect(submitted.url).toBe(
      "https://queue.fal.run/fal-ai/kling-video/v2.1/standard/image-to-video",
    );
    expect(submitted.body).toMatchObject({
      image_url: "https://cdn.shopify.com/s/shirt.jpg?width=1920",
      duration: "5",
      prompt: expect.stringContaining("Slow camera orbit"),
    });
    expect(String(submitted.body?.prompt)).toContain("must stay unchanged");

    // ৩: ভিডিও তৈরি
    resultReply = () => json({ video: { url: "https://v3.fal.media/files/v/out.mp4" } });
    expect(await job.round()).toBeNull();
    expect(generation()).toMatchObject({
      status: "ready",
      costMicros: writing + 280_000,
      output: {
        files: [{ type: "video", mime: "video/mp4" }],
        copy: {
          hook: "Summer starts here",
          headline: "Linen that breathes",
          cta: "shop_now",
          hashtags: ["linen", "summer"],
        },
      },
    });
  });
});
