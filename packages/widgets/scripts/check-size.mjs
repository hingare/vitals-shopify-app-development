// পারফরম্যান্স বাজেট: লোডার ৫KB আর প্রতিটি টুল ১০KB gzip-এর বেশি হলে CI ফেল করবে।
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = new URL("../../../apps/admin/extensions/theme-embed/assets/", import.meta.url)
  .pathname;
const LIMITS = { loader: 5 * 1024, tool: 10 * 1024, chunk: 10 * 1024 };
let failed = false;

for (const file of readdirSync(dist).filter((f) => f.endsWith(".js"))) {
  const size = gzipSync(readFileSync(join(dist, file))).length;
  const kind = file === "loader.js" ? "loader" : file.startsWith("tool-") ? "tool" : "chunk";
  const limit = LIMITS[kind];
  const ok = size <= limit;
  if (!ok) failed = true;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${file.padEnd(28)} ${(size / 1024).toFixed(2)} KB / ${limit / 1024} KB`,
  );
}

if (failed) {
  console.error("Bundle size budget exceeded");
  process.exit(1);
}
