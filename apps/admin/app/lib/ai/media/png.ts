import { crc32, deflateSync, inflateSync } from "node:zlib";

/**
 * স্বচ্ছ PNG-কে সাদা (বা অন্য রঙের) পটভূমিতে বসানো, কোনো বাড়তি লাইব্রেরি ছাড়া।
 * পটভূমি সরানোর মডেল সবসময় ৮-বিটের RGBA PNG দেয়; শুধু সেটাই (আর ৮-বিট gray+alpha) পড়া হয়।
 * অন্য কিছু হলে null, তখন ছবিটা স্বচ্ছই থাকে।
 */
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** RGB পিক্সেল থেকে PNG (প্রতি সারিতে "Sub" filter, ফাইল ছোট রাখতে) */
export function encodeRgbPng(width: number, height: number, rgb: Uint8Array): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const out = y * (stride + 1);
    raw[out] = 1;
    for (let x = 0; x < stride; x++) {
      const value = rgb[y * stride + x] as number;
      const left = x >= 3 ? (rgb[y * stride + x - 3] as number) : 0;
      raw[out + 1 + x] = (value - left) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** সবচেয়ে বড় যে ছবি নেওয়া হয় (মেমোরির সীমা): ৪০ মেগাপিক্সেল */
const MAX_PIXELS = 40_000_000;

export function flattenPng(png: Buffer, background: [number, number, number] = [255, 255, 255]) {
  if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const color = data[9];
      const interlace = data[12];
      if (depth !== 8 || interlace !== 0) return null;
      if (color === 6) channels = 4;
      else if (color === 4) channels = 2;
      else return null;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height || !channels || width * height > MAX_PIXELS) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;

  const rgb = new Uint8Array(width * height * 3);
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (current[x - channels] as number) : 0;
      const b = previous[x] as number;
      const c = x >= channels ? (previous[x - channels] as number) : 0;
      const value = line[x] as number;
      switch (filter) {
        case 0:
          current[x] = value;
          break;
        case 1:
          current[x] = (value + a) & 0xff;
          break;
        case 2:
          current[x] = (value + b) & 0xff;
          break;
        case 3:
          current[x] = (value + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          current[x] = (value + paeth(a, b, c)) & 0xff;
          break;
        default:
          return null;
      }
    }
    for (let x = 0; x < width; x++) {
      const alpha = current[x * channels + channels - 1] as number;
      for (let k = 0; k < 3; k++) {
        const color = channels === 4 ? (current[x * 4 + k] as number) : (current[x * 2] as number);
        const back = background[k] as number;
        rgb[(y * width + x) * 3 + k] = Math.round((color * alpha + back * (255 - alpha)) / 255);
      }
    }
    [previous, current] = [current, previous];
  }
  return encodeRgbPng(width, height, rgb);
}
