// src/early.ts থেকে app embed-এর app-early.liquid স্নিপেট বানায় (inline <script>, পাতা আঁকার আগে চলে)।
// স্নিপেটটা git-এ থাকে; `--check` দিলে শুধু মিলিয়ে দেখে (CI), বদলায় না।
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const entry = fileURLToPath(new URL("../src/early.ts", import.meta.url));
// fileURLToPath, not URL.pathname: on Windows pathname is "/D:/..." with %20 for spaces.
const target = fileURLToPath(
  new URL("../../../apps/admin/extensions/theme-embed/snippets/app-early.liquid", import.meta.url),
);
const check = process.argv.includes("--check");

const result = await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  build: {
    write: false,
    target: "es2020",
    minify: "esbuild",
    lib: { entry, formats: ["iife"], name: "appEarly" },
  },
});
const chunks = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
const code = chunks
  .filter((o) => o.type === "chunk")
  .map((o) => o.code)
  .join("")
  .trim();

// inline স্ক্রিপ্ট ভাঙতে পারে এমন কিছু থাকলে বানানো হয় না
for (const bad of ["</script", "<!--", "endraw"]) {
  if (code.toLowerCase().includes(bad)) {
    console.error(`early.ts build contains "${bad}", which breaks the inline <script>`);
    process.exit(1);
  }
}

const snippet = `{%- comment -%}
  স্বয়ংক্রিয়ভাবে বানানো, হাতে বদলাবেন না: packages/widgets/src/early.ts বদলে
  \`pnpm --filter @app/widgets build\` চালান (CI মিলিয়ে দেখে)।
{%- endcomment -%}
<script>{% raw %}${code}{% endraw %}</script>
`;

const size = `${(code.length / 1024).toFixed(2)} KB, ${(gzipSync(code).length / 1024).toFixed(2)} KB gzip`;
if (check) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // নেই
  }
  if (current !== snippet) {
    console.error(
      "snippets/app-early.liquid is out of date: run `pnpm --filter @app/widgets build` and commit it",
    );
    process.exit(1);
  }
  console.log(`OK   app-early.liquid is up to date (${size})`);
} else {
  writeFileSync(target, snippet);
  console.log(`app-early.liquid written (${size})`);
}
