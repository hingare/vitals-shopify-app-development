import { defineConfig, devices } from "@playwright/test";

/**
 * আসল থিমে সব টুল একসাথে (e2e/themes.ts): ডেভেলপমেন্ট স্টোরের থিমগুলোর পাতায় আমাদের এখনকার বিল্ড বসিয়ে
 * ভুল, পাতা সরা, accessibility আর Add to cart দেখা; ফল test-results/themes/report.md-তে।
 * THEME_STORE না দিলে দুটো নকল দোকানে নিজের পরীক্ষা (CI-তে এটাই চলে)। আগে `pnpm build` লাগে।
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: /themes\.ts$/,
  // শুধু নিজের ফোল্ডার মোছে, সাধারণ e2e-র ফল থাকে
  outputDir: "test-results/themes",
  globalTeardown: "./e2e/themes-report.ts",
  fullyParallel: true,
  // আসল দোকানে একসাথে বেশি পাতা না খোলা
  workers: Number(process.env.THEME_WORKERS ?? 2),
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    trace: "off",
    serviceWorkers: "block",
    // নকল দোকানের নিজে বানানো সার্টিফিকেট (নিজের পরীক্ষায়)
    ignoreHTTPSErrors: !process.env.THEME_STORE,
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
