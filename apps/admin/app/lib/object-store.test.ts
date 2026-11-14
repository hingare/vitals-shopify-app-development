import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteObjects,
  getObject,
  objectStoreKind,
  putObject,
  setObjectStoreFetchForTests,
} from "./object-store.server";

const R2_ENV = {
  R2_ACCOUNT_ID: "acc123",
  R2_ACCESS_KEY_ID: "AKTEST",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "recordings-bucket",
};
const saved = { ...process.env };
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "objects-"));
  process.env.OBJECT_STORE_DIR = dir;
});

afterEach(() => {
  for (const key of [...Object.keys(R2_ENV), "R2_ENDPOINT", "NODE_ENV", "OBJECT_STORE_DIR"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  setObjectStoreFetchForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("object store choice", () => {
  it("uses R2 only with all four settings, a local folder in development, and nothing in production", () => {
    expect(objectStoreKind({ ...R2_ENV })).toBe("r2");
    expect(objectStoreKind({ ...R2_ENV, R2_BUCKET: "" })).toBe("disk");
    expect(objectStoreKind({ NODE_ENV: "development" })).toBe("disk");
    expect(objectStoreKind({ NODE_ENV: "production" })).toBe("none");
    expect(objectStoreKind({ NODE_ENV: "production", ...R2_ENV })).toBe("r2");
  });
});

describe("local folder (development)", () => {
  it("writes, reads and deletes files, and says null for a missing one", async () => {
    await putObject("recordings/s1/r1/0.json.gz", Buffer.from("hello"));
    expect((await getObject("recordings/s1/r1/0.json.gz"))?.toString()).toBe("hello");
    expect(await getObject("recordings/s1/r1/1.json.gz")).toBeNull();
    await deleteObjects(["recordings/s1/r1/0.json.gz", "recordings/s1/r1/9.json.gz"]);
    expect(await getObject("recordings/s1/r1/0.json.gz")).toBeNull();
  });

  it("refuses names that could reach outside its folder", async () => {
    for (const key of ["../x", "/etc/passwd", "a//b", "a/../../b", "a/./b", ""]) {
      await expect(putObject(key, Buffer.from("x"))).rejects.toThrow(/Invalid object key/);
    }
  });

  it("does nothing in production without storage settings", async () => {
    process.env.NODE_ENV = "production";
    await expect(putObject("a/b", Buffer.from("x"))).rejects.toThrow(/not set up/);
    expect(await getObject("a/b")).toBeNull();
    await deleteObjects(["a/b"]);
  });
});

describe("Cloudflare R2", () => {
  type Sent = { url: string; method: string; headers: Record<string, string>; body?: Uint8Array };
  let sent: Sent[];
  let reply: (req: Sent) => Response;

  beforeEach(() => {
    Object.assign(process.env, R2_ENV);
    sent = [];
    reply = () => new Response("", { status: 200 });
    setObjectStoreFetchForTests(async (input, init) => {
      const req: Sent = {
        url: String(input),
        method: init?.method ?? "GET",
        headers: init?.headers as Record<string, string>,
        body: init?.body as Uint8Array | undefined,
      };
      sent.push(req);
      return reply(req);
    });
  });

  it("signs uploads with the hash of the exact bytes sent", async () => {
    const body = Buffer.from([0x1f, 0x8b, 1, 2, 3]);
    await putObject("recordings/s1/r1/0.json.gz", body, "application/gzip");
    const req = sent[0]!;
    expect(req.method).toBe("PUT");
    expect(req.url).toBe(
      "https://acc123.r2.cloudflarestorage.com/recordings-bucket/recordings/s1/r1/0.json.gz",
    );
    expect(req.headers["x-amz-content-sha256"]).toBe(
      createHash("sha256").update(body).digest("hex"),
    );
    expect(req.headers["content-type"]).toBe("application/gzip");
    expect(req.headers.host).toBeUndefined();
    expect(req.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKTEST\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(Buffer.from(req.body!)).toEqual(body);
  });

  it("reads files, treats 404 as missing, and reports other errors", async () => {
    reply = (req) =>
      req.url.endsWith("/there")
        ? new Response(new Uint8Array([7, 8]), { status: 200 })
        : new Response("nope", { status: req.url.endsWith("/gone") ? 404 : 500 });
    expect([...((await getObject("x/there")) ?? [])]).toEqual([7, 8]);
    expect(await getObject("x/gone")).toBeNull();
    await expect(getObject("x/broken")).rejects.toThrow(/read failed: 500/);
    await expect(putObject("x/broken", Buffer.from("a"))).rejects.toThrow(/write failed: 500/);
  });

  it("deletes many files, ignoring ones already gone, and can use another S3-style endpoint", async () => {
    process.env.R2_ENDPOINT = "https://s3.example.test/";
    reply = (req) => new Response(null, { status: req.url.endsWith("/2") ? 404 : 204 });
    await deleteObjects(["a/1", "a/2", "a/3"]);
    expect(sent.map((r) => [r.method, r.url]).sort()).toEqual([
      ["DELETE", "https://s3.example.test/recordings-bucket/a/1"],
      ["DELETE", "https://s3.example.test/recordings-bucket/a/2"],
      ["DELETE", "https://s3.example.test/recordings-bucket/a/3"],
    ]);
  });
});
