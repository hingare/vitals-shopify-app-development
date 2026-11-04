import type { StoreConfig, ToolModule } from "./types";

/**
 * স্টোরফ্রন্ট লোডার (বাজেট: ৫KB gzip)।
 * পেজ লোডের পর ব্রাউজার ফাঁকা হলে চালু টুলগুলো আলাদা আলাদা ফাইল থেকে লোড করে।
 * একটা টুল ভাঙলেও বাকিগুলো চলবে।
 */
function start(config: StoreConfig) {
  for (const tool of config.tools) {
    const url = `${config.assetBase}tool-${tool.id}.js`;
    import(/* @vite-ignore */ url)
      .then((mod: ToolModule) => mod.mount({ config, settings: tool.settings }))
      .catch((err) => console.warn(`[app] tool ${tool.id} failed`, err));
  }
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
