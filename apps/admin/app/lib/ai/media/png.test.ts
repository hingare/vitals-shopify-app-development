import { crc32, deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { flattenPng } from "./png";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** পরীক্ষার PNG: প্রতিটা সারিতে বলে দেওয়া filter (০-৪) দিয়ে, যাতে পড়ার প্রতিটা পথ যাচাই হয় */
function encodePng(
  width: number,
  height: number,
  pixels: number[],
  options: { color?: 4 | 6 | 2; depth?: number; interlace?: number; filter?: number } = {},
) {
  const color = options.color ?? 6;
  const channels = color === 6 ? 4 : color === 4 ? 2 : 3;
  const stride = width * channels;
  const filter = options.filter ?? 0;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const value = pixels[y * stride + x]!;
      const a = x >= channels ? pixels[y * stride + x - channels]! : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels]! : 0;
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]!;
      raw[y * (stride + 1) + 1 + x] = (value - predicted) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = options.depth ?? 8;
  header[9] = color;
  header[12] = options.interlace ?? 0;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ফলের RGB PNG পড়া (লেখার দিকটা প্রতিটা সারিতে Sub filter দেয়) */
function decodeRgb(png: Buffer) {
  expect(png.subarray(0, 8).equals(SIGNATURE)).toBe(true);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[25]).toBe(2);
  let offset = 8;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    if (png.toString("latin1", offset + 4, offset + 8) === "IDAT") {
      idat.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)]).toBe(1);
    const row: number[] = [];
    for (let x = 0; x < stride; x++) {
      const left = x >= 3 ? row[x - 3]! : 0;
      row.push((raw[y * (stride + 1) + 1 + x]! + left) & 0xff);
    }
    out.push(...row);
  }
  return { width, height, pixels: out };
}

// ২×২: লাল (পুরো দেখা যায়), স্বচ্ছ নীল (একদম দেখা যায় না), আধা-স্বচ্ছ কালো, সবুজ (প্রায় পুরো)
const RGBA = [255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 128, 0, 255, 0, 250];
const ON_WHITE = [255, 0, 0, 255, 255, 255, 127, 127, 127, 5, 255, 5];

describe("putting a transparent PNG on white", () => {
  it("blends every pixel with white by its transparency, whatever row filter the file uses", () => {
    for (const filter of [0, 1, 2, 3, 4]) {
      const out = flattenPng(encodePng(2, 2, RGBA, { filter }));
      expect(out, `filter ${filter}`).not.toBeNull();
      expect(decodeRgb(out!)).toEqual({ width: 2, height: 2, pixels: ON_WHITE });
    }
  });

  it("handles gray with transparency and another background colour", () => {
    const out = flattenPng(encodePng(2, 1, [200, 255, 200, 0], { color: 4, filter: 4 }), [0, 0, 0]);
    expect(decodeRgb(out!).pixels).toEqual([200, 200, 200, 0, 0, 0]);
  });

  it("leaves files it cannot read safely as they are (null)", () => {
    expect(flattenPng(encodePng(1, 1, [1, 2, 3], { color: 2 }))).toBeNull();
    expect(flattenPng(encodePng(1, 1, [1, 2, 3, 4], { depth: 16 }))).toBeNull();
    expect(flattenPng(encodePng(1, 1, [1, 2, 3, 4], { interlace: 1 }))).toBeNull();
    expect(flattenPng(Buffer.from("not a png at all, just some text here"))).toBeNull();
    const broken = encodePng(2, 2, RGBA);
    expect(flattenPng(broken.subarray(0, broken.length - 20))).toBeNull();
  });
});
