import { runsOn } from "./pages";
import type { StoreConfig, ToolModule } from "./types";

/**
 * স্টোরফ্রন্ট লোডার (বাজেট: ৫KB gzip)।
 * পেজ লোডের পর ব্রাউজার ফাঁকা হলে চালু টুলগুলো আলাদা আলাদা ফাইল থেকে লোড করে, শুধু যে টুল এই
 * পাতায় কিছু করে (src/pages.ts)। একটা টুল ভাঙলেও বাকিগুলো চলবে।
 */

/**
 * একটানা এতটুকু সময় (ms) টুলের ফাইল চাওয়া, তারপর ব্রাউজারকে ছেড়ে দেওয়া। প্রতিটা import()-এ ব্রাউজারের
 * কিছু কাজ (ঠিকানা, ক্যাশ, অনুরোধ তৈরি): সব টুল চালু থাকলে প্রোডাক্ট পাতায় প্রায় ৫০টা, একটানা প্রায়
 * ১০ms, ফোনে কয়েক গুণ। এমন লম্বা কাজে পাতা ক্লিকে সাড়া দেয় না (Lighthouse-এর TBT)।
 */
const SLICE_MS = 3;

function load(config: StoreConfig, tool: StoreConfig["tools"][number]) {
  const url = `${config.assetBase}tool-${tool.id}.js`;
  import(/* @vite-ignore */ url)
    .then((mod: ToolModule) => mod.mount({ config, settings: tool.settings }))
    .catch((err) => console.warn(`[app] tool ${tool.id} failed`, err));
}

function start(config: StoreConfig) {
  const tools = config.tools.filter((tool) => runsOn(tool.id, config.pageType));
  let next = 0;
  const slice = () => {
    const until = performance.now() + SLICE_MS;
    while (next < tools.length) {
      load(config, tools[next++]!);
      if (performance.now() >= until) break;
    }
    if (next < tools.length) setTimeout(slice, 0);
  };
  slice();
}

const config = window.__APP_CONFIG__;
if (config && config.tools.length > 0) {
  const run = () => start(config);
  if ("requestIdleCallback" in window) {
    requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 1);
  }
}
