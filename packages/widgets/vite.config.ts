import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// প্রতিটি টুল আলাদা ফাইলে বিল্ড হয়, যাতে স্টোরে শুধু চালু টুলের কোডই লোড হয়।
const toolsDir = resolve(__dirname, "src/tools");
const toolEntries = Object.fromEntries(
  readdirSync(toolsDir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => [`tool-${f.replace(/\.tsx$/, "")}`, resolve(toolsDir, f)]),
);

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: { loader: resolve(__dirname, "src/loader.ts"), ...toolEntries },
      preserveEntrySignatures: "exports-only",
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunk-[name].js",
      },
    },
  },
});
