/**
 * অন্য সাইটের লিংক নতুন ট্যাবে খোলে, যাতে ক্রেতা স্টোর ছেড়ে না যায়।
 * ক্লিকের মুহূর্তে দেখে, তাই পরে যোগ হওয়া লিংকেও কাজ করে।
 */
export function mount() {
  document.addEventListener(
    "click",
    (event) => {
      const link = (event.target as Element | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!link || link.target || link.hasAttribute("download")) return;
      if (!/^https?:$/.test(link.protocol) || link.hostname === location.hostname) return;
      // স্টোরের নিজের চেকআউট বা অ্যাকাউন্ট (অন্য ডোমেইনে হলেও) একই ট্যাবে থাকে
      if (/(^|\.)(myshopify\.com|shopify\.com|shop\.app)$/.test(link.hostname)) return;
      link.target = "_blank";
      link.rel = `${link.rel} noopener`.trim();
    },
    true,
  );
}
