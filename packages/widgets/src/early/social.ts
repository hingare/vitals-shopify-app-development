/** শেয়ার বাটন: early.ts পাতা আঁকার আগেই বসায়, টুলের ফাইল পরে এসে লিংক কপির কাজ আর গোনা জুড়ে দেয় */
import { earlyT } from "../i18n-early";
import { h } from "./h";

export type Network = "facebook" | "x" | "pinterest" | "whatsapp" | "email" | "copy";

export interface SocialSettings {
  networks: Network[];
  heading: string;
  colors: { background: string; text: string; accent: string };
}

const NAMES: Record<Exclude<Network, "copy">, string> = {
  facebook: "Facebook",
  x: "X",
  pinterest: "Pinterest",
  whatsapp: "WhatsApp",
  email: "Email",
};

/** প্রতিটি নেটওয়ার্কের নিজের শেয়ার লিংক (কোনো থার্ড-পার্টি স্ক্রিপ্ট লোড হয় না) */
export function shareUrl(
  network: Exclude<Network, "copy">,
  url: string,
  title: string,
  image = "",
) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  switch (network) {
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case "x":
      return `https://x.com/intent/post?url=${u}&text=${t}`;
    case "pinterest":
      return `https://pinterest.com/pin/create/button/?url=${u}&description=${t}${image ? `&media=${encodeURIComponent(image)}` : ""}`;
    case "whatsapp":
      return `https://wa.me/?text=${t}%20${u}`;
    case "email":
      return `mailto:?subject=${t}&body=${u}`;
  }
}

/** লিংক কপির বাটন চেনার জন্য */
export const COPY = "data-app-copy";

export function buildSocial(s: SocialSettings, locale: string): HTMLElement {
  const url = location.origin + location.pathname;
  const title = document.title;
  const image = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content ?? "";
  const pill = `display:inline-flex;align-items:center;min-height:36px;padding:0 14px;border-radius:18px;border:0;background:${s.colors.background};color:${s.colors.text};font-size:13px;text-decoration:none;cursor:pointer`;
  return h(
    "div",
    "margin:12px 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px",
    {},
    ...(s.heading ? [h("span", "font-weight:600;margin-right:4px", {}, s.heading)] : []),
    ...s.networks.flatMap((network): HTMLElement[] =>
      network === "copy"
        ? [
            h(
              "button",
              pill,
              { type: "button", [COPY]: "" },
              h("span", "", { "aria-live": "polite" }, earlyT(locale, "copyLink")),
            ),
          ]
        : network in NAMES
          ? [
              h(
                "a",
                pill,
                {
                  href: shareUrl(network, url, title, image),
                  target: "_blank",
                  rel: "noopener",
                  "aria-label": `${earlyT(locale, "share")} ${NAMES[network]}`,
                },
                NAMES[network],
              ),
            ]
          : [],
    ),
  );
}
