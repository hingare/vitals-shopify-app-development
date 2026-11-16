import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db.server", async () => ({ default: (await import("../../test-db")).fakeDb }));
const { fakeDb: db, resetFakeDb } = await import("../../test-db");
const { JPEG, MP4, PNG } = await import("./test-files");
const { getObject, putObject } = await import("../../object-store.server");
const files = await import("./files.server");
const {
  MEDIA_URL_TTL_SECONDS,
  allowedMediaUrl,
  deleteShopAiMedia,
  imageSize,
  mediaResponse,
  pruneAiMedia,
  releaseMedia,
  setMediaFetchForTests,
  signMediaPath,
  sniffMedia,
  storeMediaFiles,
  verifyMediaQuery,
} = files;

const WEBP = (() => {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(22, 4);
  buf.write("WEBPVP8X", 8, "latin1");
  buf.writeUInt32LE(10, 16);
  buf.writeUIntLE(1199, 24, 3);
  buf.writeUIntLE(1499, 27, 3);
  return buf;
})();

let dir: string;
const saved = { OBJECT_STORE_DIR: process.env.OBJECT_STORE_DIR };
let downloads: Record<string, () => Response>;

beforeEach(() => {
  resetFakeDb();
  dir = mkdtempSync(join(tmpdir(), "ai-media-"));
  process.env.OBJECT_STORE_DIR = dir;
  downloads = {};
  setMediaFetchForTests(async (input) => {
    const answer = downloads[String(input)];
    if (!answer) throw new TypeError("fetch failed");
    return answer();
  });
});

afterEach(() => {
  setMediaFetchForTests(null);
  if (saved.OBJECT_STORE_DIR === undefined) delete process.env.OBJECT_STORE_DIR;
  else process.env.OBJECT_STORE_DIR = saved.OBJECT_STORE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("what a downloaded file really is", () => {
  it("recognises PNG, JPEG, WebP and MP4 by their first bytes, and reads photo sizes", () => {
    expect(sniffMedia(PNG)).toBe("image/png");
    expect(sniffMedia(JPEG)).toBe("image/jpeg");
    expect(sniffMedia(WEBP)).toBe("image/webp");
    expect(sniffMedia(MP4)).toBe("video/mp4");
    expect(sniffMedia(Buffer.from("<html>not an image</html>"))).toBeNull();
    expect(imageSize(PNG, "image/png")).toEqual({ width: 2, height: 1 });
    expect(imageSize(JPEG, "image/jpeg")).toEqual({ width: 800, height: 600 });
    expect(imageSize(WEBP, "image/webp")).toEqual({ width: 1200, height: 1500 });
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg")).toBeNull();
  });

  it("downloads only from fal's own addresses", () => {
    for (const ok of [
      "https://v3.fal.media/files/lion/abc.png",
      "https://fal.media/files/x.mp4",
      "https://storage.googleapis.com/falserverless/model_tests/x.png",
    ]) {
      expect(allowedMediaUrl(ok), ok).not.toBeNull();
    }
    for (const bad of [
      "http://v3.fal.media/files/a.png",
      "https://evil.com/fal.media/a.png",
      "https://fal.media.evil.com/a.png",
      "https://user:pass@v3.fal.media/a.png",
      "https://v3.fal.media:8443/a.png",
      "https://storage.googleapis.com/other-bucket/a.png",
      "https://169.254.169.254/latest/meta-data",
      42,
    ]) {
      expect(allowedMediaUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe("keeping results in our storage", () => {
  it("stores the file under the shop and task, puts it on white when asked, and remembers the key", async () => {
    const generation = db.aiGeneration.seed({ shopId: "shop1", toolId: "ai-background-remover" });
    const url = "https://v3.fal.media/files/a/out.png";
    downloads[url] = () => new Response(new Uint8Array(PNG));
    const stored = await storeMediaFiles("shop1", generation.id as string, [url], "image", {
      flatten: "white",
    });
    const key = `ai-media/shop1/${generation.id as string}/0.png`;
    expect(stored).toEqual([
      expect.objectContaining({ key, type: "image", mime: "image/png", width: 2, height: 1 }),
    ]);
    expect(generation.mediaKeys).toEqual([key]);
    const saved = await getObject(key);
    // সাদায় বসানো ছবি RGB (color type 2), আর স্বচ্ছ নয়
    expect(saved?.[25]).toBe(2);
  });

  it("refuses other addresses, wrong file types and huge files, and says busy for passing troubles", async () => {
    const id = db.aiGeneration.seed({ shopId: "shop1" }).id as string;
    await expect(
      storeMediaFiles("shop1", id, ["https://evil.com/x.png"], "image"),
    ).rejects.toMatchObject({ code: "failed" });
    const url = "https://v3.fal.media/files/a/out";
    downloads[url] = () => new Response(new Uint8Array(MP4));
    await expect(storeMediaFiles("shop1", id, [url], "image")).rejects.toMatchObject({
      code: "failed",
    });
    downloads[url] = () =>
      new Response(new Uint8Array(PNG), {
        headers: { "content-length": String(200 * 1024 * 1024) },
      });
    await expect(storeMediaFiles("shop1", id, [url], "video")).rejects.toMatchObject({
      code: "failed",
    });
    downloads[url] = () => new Response("", { status: 503 });
    await expect(storeMediaFiles("shop1", id, [url], "image")).rejects.toMatchObject({
      code: "busy",
    });
    await expect(
      storeMediaFiles("shop1", id, ["https://v3.fal.media/files/missing.png"], "image"),
    ).rejects.toMatchObject({ code: "busy" });
    await expect(storeMediaFiles("shop1", id, [], "image")).rejects.toMatchObject({
      code: "failed",
    });
  });

  it("removes the files of a half-finished download so nothing is left behind", async () => {
    const id = db.aiGeneration.seed({ shopId: "shop1" }).id as string;
    downloads["https://v3.fal.media/files/1.jpg"] = () => new Response(new Uint8Array(JPEG));
    downloads["https://v3.fal.media/files/2.jpg"] = () => new Response("", { status: 502 });
    await expect(
      storeMediaFiles(
        "shop1",
        id,
        ["https://v3.fal.media/files/1.jpg", "https://v3.fal.media/files/2.jpg"],
        "image",
      ),
    ).rejects.toMatchObject({ code: "busy" });
    expect(await getObject(`ai-media/shop1/${id}/0.jpg`)).toBeNull();
    expect(db.aiGeneration.rows[0]?.mediaKeys).toEqual([]);
  });
});

describe("signed preview addresses", () => {
  const key = "ai-media/shop1/gen1/0.png";
  const now = Date.UTC(2026, 10, 14, 12);
  const params = (path: string) => new URL(path, "https://app.example.com").searchParams;

  it("opens the file until the address expires", () => {
    const path = signMediaPath(key, {}, now);
    expect(path.startsWith("/media?")).toBe(true);
    expect(verifyMediaQuery(params(path), now)).toEqual({ key, download: "" });
    expect(
      verifyMediaQuery(params(path), now + (MEDIA_URL_TTL_SECONDS - 60) * 1000),
    ).not.toBeNull();
    expect(verifyMediaQuery(params(path), now + (MEDIA_URL_TTL_SECONDS + 1) * 1000)).toBeNull();
  });

  it("refuses any change to the file, the time or the download name", () => {
    const path = signMediaPath(key, { download: "my photo (1).png" }, now);
    const good = params(path);
    expect(verifyMediaQuery(good, now)).toEqual({ key, download: "my-photo-1-.png" });
    for (const [name, value] of [
      ["k", "ai-media/shop2/gen9/0.png"],
      ["e", String(Number(good.get("e")) + 3600)],
      ["d", "other.png"],
      ["s", "x".repeat(43)],
    ] as const) {
      const changed = new URLSearchParams(good);
      changed.set(name, value);
      expect(verifyMediaQuery(changed, now), name).toBeNull();
    }
    const outside = params(signMediaPath("recordings/shop1/r1/0.json.gz", {}, now));
    expect(verifyMediaQuery(outside, now)).toBeNull();
  });

  it("serves byte ranges for video players and safe headers", async () => {
    const body = Buffer.from("0123456789");
    const full = mediaResponse(body, "video/mp4", null);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-length")).toBe("10");
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    expect(full.headers.get("content-security-policy")).toContain("sandbox");
    const part = mediaResponse(body, "video/mp4", "bytes=2-5");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");
    expect(await mediaResponse(body, "video/mp4", "bytes=-3").text()).toBe("789");
    expect(await mediaResponse(body, "video/mp4", "bytes=8-").text()).toBe("89");
    expect(await mediaResponse(body, "video/mp4", "bytes=4-99").text()).toBe("456789");
    expect(mediaResponse(body, "video/mp4", "bytes=10-").status).toBe(416);
    expect(mediaResponse(body, "video/mp4", "bytes=5-2").status).toBe(416);
    expect(mediaResponse(body, "video/mp4", "items=1-2").status).toBe(416);
    expect(
      mediaResponse(body, "image/png", null, "photo.png").headers.get("content-disposition"),
    ).toBe('attachment; filename="photo.png"');
  });
});

describe("cleaning up", () => {
  const DAY = 86_400_000;
  const now = new Date(Date.UTC(2026, 10, 14));

  async function withFiles(shopId: string, createdAt: Date) {
    const row = db.aiGeneration.seed({ shopId, createdAt });
    const key = `ai-media/${shopId}/${row.id as string}/0.png`;
    await putObject(key, PNG, "image/png");
    row.mediaKeys = [key];
    row.output = {
      files: [{ key, type: "image", mime: "image/png", bytes: 1, width: 2, height: 1 }],
      selected: [0],
      expired: false,
    };
    return { row, key };
  }

  it("removes files after 30 days and marks the result as expired", async () => {
    const old = await withFiles("shop1", new Date(now.getTime() - 31 * DAY));
    const recent = await withFiles("shop1", new Date(now.getTime() - 2 * DAY));
    expect(await pruneAiMedia(now)).toBe(1);
    expect(await getObject(old.key)).toBeNull();
    expect(old.row.mediaKeys).toEqual([]);
    expect(old.row.output).toMatchObject({ expired: true, selected: [0] });
    expect(await getObject(recent.key)).not.toBeNull();
    expect(recent.row.mediaKeys).toEqual([recent.key]);
    expect(await pruneAiMedia(now)).toBe(0);
  });

  it("removes a discarded task's files, and every file of a store that asked to be erased", async () => {
    const one = await withFiles("shop1", now);
    await releaseMedia(one.row.id as string);
    expect(await getObject(one.key)).toBeNull();
    expect(one.row.mediaKeys).toEqual([]);

    const a = await withFiles("shopA", now);
    const b = await withFiles("shopA", now);
    const other = await withFiles("shopB", now);
    await deleteShopAiMedia("shopA");
    expect(await getObject(a.key)).toBeNull();
    expect(await getObject(b.key)).toBeNull();
    expect([a.row.mediaKeys, b.row.mediaKeys]).toEqual([[], []]);
    expect(await getObject(other.key)).not.toBeNull();
  });
});
