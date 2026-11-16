import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", async () => ({ default: (await import("./test-db")).fakeDb }));
const dir = mkdtempSync(join(tmpdir(), "recordings-"));
process.env.OBJECT_STORE_DIR = dir;
const { fakeDb: db, resetFakeDb } = await import("./test-db");
const rec = await import("./recordings.server");
const { getObject } = await import("./object-store.server");
const { runJob } = await import("./queue.server");
const { customerData, redactCustomer } = await import("./privacy.server");

const KEY = "r".repeat(43);
const OTHER = "o".repeat(43);
const T0 = new Date("2026-11-14T10:00:00Z");
const TS = 1_763_114_400_000;
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

type Shop = { id: string; plan: string };
let shop: Shop;

const meta = (t: number, href = "https://s.example/products/linen?utm=x") => ({
  type: 4,
  timestamp: t,
  data: { href, width: 1280, height: 720 },
});
const full = (t: number) => ({
  type: 2,
  timestamp: t,
  data: { node: { type: 0, childNodes: [] } },
});
const click = (t: number) => ({
  type: 3,
  timestamp: t,
  data: { source: 2, type: 2, id: 5, x: 1, y: 1 },
});
const move = (t: number) => ({ type: 3, timestamp: t, data: { source: 1, positions: [] } });
const pack = (events: unknown[]) => gzipSync(JSON.stringify(events)).toString("base64");

const send = (seq: number, events: unknown[], extra: Record<string, unknown> = {}, now = T0) =>
  rec.ingestChunk(shop, { key: KEY, seq, data: pack(events), page: "/", ...extra }, {}, now);
const recording = () => db.recording.rows[0]!;
const used = () => (db.usageCounter.rows[0]?.used as number | undefined) ?? 0;

beforeEach(() => {
  resetFakeDb();
  delete process.env.NODE_ENV;
  const row = db.shop.seed({ domain: "a.myshopify.com", plan: "professional" });
  shop = { id: row.id as string, plan: "professional" };
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("checking what the browser sends", () => {
  it("accepts rrweb events and counts pages, clicks and screen size", () => {
    const stats = rec.inspectEvents([meta(TS), full(TS + 1), click(TS + 500), move(TS + 900)]);
    expect(stats).toEqual({
      events: 4,
      first: TS,
      last: TS + 900,
      pageViews: 1,
      paths: ["/products/linen"],
      clicks: 1,
      width: 1280,
      height: 720,
    });
  });

  it("rejects anything that is not a list of rrweb events", () => {
    for (const bad of [
      null,
      {},
      [],
      [{ type: 9, timestamp: TS }],
      [{ type: 2, timestamp: -1 }],
      [{ type: 2, timestamp: "now" }],
      [{ type: 1.5, timestamp: TS }],
      [[1, 2]],
      ["x"],
    ]) {
      expect(rec.inspectEvents(bad)).toBeNull();
    }
  });

  it("joins stored lists without reading them", () => {
    expect(rec.joinArrays(['[{"a":1}]', " [ ] ", '[{"b":2},{"c":3}]'])).toBe(
      '[{"a":1},{"b":2},{"c":3}]',
    );
    expect(rec.joinArrays([])).toBe("[]");
  });
});

describe("taking in parts of a recording", () => {
  it("starts a recording on the first part, counts it once against the monthly limit, and waits to store it", async () => {
    expect(
      await send(0, [meta(TS), full(TS + 1)], { device: "mobile", customerId: "123" }),
    ).toEqual({
      ok: true,
      created: true,
    });
    expect(await send(1, [click(TS + 2_000), move(TS + 3_000)], {}, at(10))).toEqual({
      ok: true,
      created: false,
    });
    expect(used()).toBe(1);
    expect(recording()).toMatchObject({
      device: "mobile",
      customerId: "123",
      entryPath: "/products/linen",
      pages: ["/products/linen"],
      pageViews: 1,
      clicks: 1,
      chunks: 2,
      durationMs: 3_000,
      width: 1280,
      height: 720,
      lastChunkAt: at(10),
      parts: 0,
    });
    expect(recording().keyHash).toBe(rec.hashRecordingKey(KEY));
    expect(JSON.stringify(recording())).not.toContain(KEY);
    expect(db.recordingChunk.rows).toHaveLength(2);
    const job = db.job.rows.find((row) => row.kind === `rec-finalize:${recording().id}`);
    expect(job?.runAt).toEqual(new Date(T0.getTime() + rec.IDLE_MS));
  });

  it("takes the last part sent without gzip when the shopper leaves the page, and ignores a repeated part", async () => {
    await send(0, [meta(TS), full(TS + 1)]);
    const beacon = { key: KEY, seq: 1, events: [click(TS + 100)], page: "/" };
    expect(await rec.ingestChunk(shop, beacon, {}, at(5))).toEqual({ ok: true, created: false });
    expect(await rec.ingestChunk(shop, beacon, {}, at(6))).toEqual({ ok: true, created: false });
    expect(recording()).toMatchObject({ chunks: 2, clicks: 1 });
  });

  it("refuses broken, oversized or zip-bomb parts without counting a recording", async () => {
    const bomb = gzipSync(Buffer.alloc(rec.MAX_CHUNK_RAW + 10, 32)).toString("base64");
    const cases: Array<Record<string, unknown>> = [
      { key: "short", seq: 0, data: pack([full(TS)]) },
      { key: KEY, seq: -1, data: pack([full(TS)]) },
      { key: KEY, seq: 1.5, data: pack([full(TS)]) },
      { key: KEY, seq: 0, data: Buffer.from("not gzip at all, really").toString("base64") },
      { key: KEY, seq: 0, data: gzipSync("not json").toString("base64") },
      { key: KEY, seq: 0, data: pack([{ type: 99, timestamp: TS }]) },
      { key: KEY, seq: 0, data: bomb },
      { key: KEY, seq: 0 },
    ];
    for (const input of cases) {
      expect(await rec.ingestChunk(shop, input as never, {}, T0)).toEqual({
        ok: false,
        error: "invalid",
      });
    }
    expect(db.recording.rows).toHaveLength(0);
    expect(used()).toBe(0);
  });

  it("stops new recordings when the month's limit is used up, or on Starter", async () => {
    db.usageCounter.seed({ shopId: shop.id, meter: "recordings", month: "2026-11", used: 2_000 });
    expect(await send(0, [full(TS)])).toEqual({ ok: false, error: "cap" });
    expect(await rec.canRecord(shop, T0)).toBe(false);
    resetFakeDb();
    shop = {
      id: db.shop.seed({ domain: "b.myshopify.com", plan: "starter" }).id as string,
      plan: "starter",
    };
    expect(await send(0, [full(TS)])).toEqual({ ok: false, error: "cap" });
    expect(db.recording.rows).toHaveLength(0);
  });

  it("lets the route refuse new recordings (rate limit) but keeps taking parts of running ones", async () => {
    const no = { mayCreate: () => false };
    expect(
      await rec.ingestChunk(shop, { key: KEY, seq: 0, data: pack([full(TS)]) }, no, T0),
    ).toEqual({
      ok: false,
      error: "limit",
    });
    await send(0, [full(TS)]);
    expect(
      await rec.ingestChunk(shop, { key: KEY, seq: 1, data: pack([click(TS + 1)]) }, no, T0),
    ).toEqual({
      ok: true,
      created: false,
    });
  });

  it("stops a recording that runs too long, and keeps refusing it", async () => {
    await send(0, [meta(TS), full(TS + 1)]);
    expect(await send(1, [move(TS + rec.MAX_DURATION_MS + 1_000)])).toEqual({
      ok: false,
      error: "full",
    });
    expect(recording().stopped).toBe("full");
    expect(await send(2, [move(TS + 5)])).toEqual({ ok: false, error: "full" });
    expect(recording().chunks).toBe(1);
  });

  it("records nothing in production until storage is set up", async () => {
    process.env.NODE_ENV = "production";
    expect(await send(0, [full(TS)])).toEqual({ ok: false, error: "storage" });
    expect(await rec.canRecord(shop, T0)).toBe(false);
    expect(used()).toBe(0);
  });
});

describe("storing and replaying", () => {
  const eventsOf = async (gz: Buffer | null) => JSON.parse(gunzipSync(gz!).toString("utf8"));

  it("waits until the visit goes quiet, then stores all parts as one file", async () => {
    await send(1, [click(TS + 2_000)], {}, at(10));
    await send(0, [meta(TS), full(TS + 1)], {}, at(11));
    const id = recording().id as string;
    expect(await rec.finalizeRecording(id, at(60))).toEqual({
      again: true,
      delayMs: rec.IDLE_MS - 49_000,
    });
    expect(await rec.finalizeRecording(id, new Date(at(11).getTime() + rec.IDLE_MS))).toEqual({});
    expect(db.recordingChunk.rows).toHaveLength(0);
    expect(recording()).toMatchObject({ parts: 1 });
    expect(recording().storedBytes).toBeGreaterThan(0);
    const stored = await eventsOf(await getObject(rec.partKey(shop.id, id, 0)));
    // অংশের ক্রমে (seq), পৌঁছানোর ক্রমে নয়
    expect(stored.map((e: { type: number }) => e.type)).toEqual([4, 2, 3]);
  });

  it("adds a second file if the shopper comes back later, and replays files plus parts not stored yet", async () => {
    await send(0, [meta(TS), full(TS + 1)]);
    const id = recording().id as string;
    await rec.finalizeRecording(id, at(400));
    await send(1, [click(TS + 500_000)], {}, at(500));
    await rec.finalizeRecording(id, at(900));
    await send(2, [move(TS + 600_000)], {}, at(950));
    expect(recording().parts).toBe(2);
    const replay = await eventsOf(await rec.recordingEvents(shop.id, id));
    expect(replay.map((e: { timestamp: number }) => e.timestamp)).toEqual([
      TS,
      TS + 1,
      TS + 500_000,
      TS + 600_000,
    ]);
    expect(await rec.recordingEvents("another-shop", id)).toBeNull();
  });

  it("runs from the job queue", async () => {
    await send(0, [full(TS)]);
    const job = db.job.rows.find((row) => String(row.kind).startsWith("rec-finalize:"))!;
    recording().lastChunkAt = new Date(Date.now() - rec.IDLE_MS - 1_000);
    await runJob({
      id: job.id as string,
      shopId: shop.id,
      kind: job.kind as string,
      payload: job.payload as Record<string, unknown>,
      attempts: 1,
    });
    expect(recording().parts).toBe(1);
    expect(db.job.rows.find((row) => row.id === job.id)?.status).toBe("done");
  });
});

describe("the merchant's list, deleting and clean-up", () => {
  const seedRecording = (data: Record<string, unknown>) =>
    db.recording.seed({ shopId: shop.id, keyHash: Math.random().toString(36), chunks: 1, ...data });

  it("lists newest first with device and length filters, a page at a time", async () => {
    seedRecording({ device: "mobile", durationMs: 5_000, createdAt: at(1) });
    seedRecording({ device: "desktop", durationMs: 90_000, createdAt: at(2) });
    seedRecording({ device: "desktop", durationMs: 200_000, createdAt: at(3) });
    seedRecording({ device: "desktop", durationMs: 1_000, createdAt: at(4), chunks: 0 });
    const all = await rec.listRecordings(shop.id);
    expect(all.rows.map((r) => r.createdAt)).toEqual([at(3), at(2), at(1)]);
    expect((await rec.listRecordings(shop.id, { device: "mobile" })).rows).toHaveLength(1);
    expect((await rec.listRecordings(shop.id, { minSeconds: 60 })).rows).toHaveLength(2);
    const page = await rec.listRecordings(shop.id, {}, 2);
    expect(page.more).toBe(true);
    const next = await rec.listRecordings(shop.id, { before: page.rows[1]!.createdAt }, 2);
    expect(next).toEqual({ rows: [expect.objectContaining({ createdAt: at(1) })], more: false });
  });

  it("deletes a recording with its stored files", async () => {
    await send(0, [full(TS)]);
    const id = recording().id as string;
    await rec.finalizeRecording(id, at(400));
    expect(await getObject(rec.partKey(shop.id, id, 0))).not.toBeNull();
    expect(await rec.deleteRecording("another-shop", id)).toBe(false);
    expect(await rec.deleteRecording(shop.id, id)).toBe(true);
    expect(db.recording.rows).toHaveLength(0);
    expect(await getObject(rec.partKey(shop.id, id, 0))).toBeNull();
  });

  it("removes recordings after 30 days", async () => {
    seedRecording({ createdAt: new Date(T0.getTime() - 31 * 86_400_000) });
    seedRecording({ createdAt: new Date(T0.getTime() - 29 * 86_400_000) });
    expect(await rec.pruneRecordings(T0)).toBe(1);
    expect(db.recording.rows).toHaveLength(1);
  });

  it("removes every recording of a store", async () => {
    seedRecording({});
    seedRecording({});
    expect(await rec.deleteShopRecordings(shop.id)).toBe(2);
    expect(db.recording.rows).toHaveLength(0);
  });

  it("includes a logged-in shopper's recordings in their data, and erases only theirs", async () => {
    await send(0, [meta(TS), full(TS + 1)], { customerId: "77" });
    await rec.ingestChunk(shop, { key: OTHER, seq: 0, data: pack([full(TS)]) }, {}, T0);
    const data = await customerData(shop.id, { customerId: "77", email: null });
    expect(data.recordings).toEqual([
      { recordedAt: T0.toISOString(), seconds: 0, device: "desktop", pages: ["/products/linen"] },
    ]);
    await redactCustomer(shop.id, { customerId: "77", email: null });
    expect(db.recording.rows).toHaveLength(1);
    expect(db.recording.rows[0]!.customerId).toBeNull();
  });
});
