import { defineConfig, devices } from "@playwright/test";

/**
 * স্টোরফ্রন্ট উইজেটের পরীক্ষা নকল দোকানের পাতায় (e2e/store.ts): accessibility (axe-core),
 * কীবোর্ড দিয়ে চালানো আর লেআউট সরে যাওয়া (CLS)। আগে `pnpm build` লাগে, কারণ উইজেট চলে বিল্ড করা ফাইল থেকে।
 * ফাইলের নাম *.e2e.ts, যাতে vitest এগুলো ধরে না।
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    trace: "off",
    // Push Notifications-এর service worker নকল দোকানে লাগে না
    serviceWorkers: "block",
    locale: "en-US",
    timezoneId: "Asia/Dhaka",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
