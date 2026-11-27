import { defineConfig } from "@playwright/test";

/**
 * দোকানের গতি: নকল দোকানে মোবাইল Lighthouse, আমাদের টুল ছাড়া আর টুলসহ (e2e/speed.ts)।
 * সাধারণ e2e থেকে আলাদা, কারণ এক একটা Lighthouse চালাতে কয়েক সেকেন্ড লাগে আর একসাথে চালালে
 * মাপ নষ্ট হয়। আগে `pnpm build` লাগে।
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: /speed\.ts$/,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60 * 60_000,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
});
