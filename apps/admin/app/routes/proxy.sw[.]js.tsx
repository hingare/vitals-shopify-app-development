/**
 * Push Notifications-এর service worker (App Proxy: /apps/app-tools/sw.js)।
 * Service worker-কে স্টোরের নিজের ডোমেইন থেকেই আসতে হয়, তাই এটা app proxy দিয়ে যায়।
 * এটা শুধু নোটিফিকেশন দেখায় আর ক্লিকে লিংক খোলে; স্টোরের কোনো পেজ বা অনুরোধ ধরে না।
 */
const WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }
  if (!data.title) return;
  event.waitUntil(
    self.registration.showNotification(String(data.title), {
      body: String(data.body || ""),
      tag: data.tag ? String(data.tag) : undefined,
      data: { url: data.url ? String(data.url) : "" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (url && /^https:\\/\\//.test(url)) event.waitUntil(self.clients.openWindow(url));
});
`;

export const loader = () =>
  new Response(WORKER, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
