import { render } from "preact";
import type { ToolContext } from "../types";

interface Settings {
  message: string;
  acceptText: string;
  declineText: string;
  privacyLink: string;
  privacyText: string;
  onlyWhereRequired: boolean;
  position: "bottom" | "top";
  colors: { background: string; text: string; accent: string };
}

/** Shopify-র নিজের কুকি ব্যানার */
const SHOPIFY_BANNER = "#shopify-pc__banner, #shopify-pc__prefs";

function loadPrivacyApi(): Promise<NonNullable<Window["Shopify"]>["customerPrivacy"] | null> {
  return new Promise((resolve) => {
    const shopify = window.Shopify;
    if (shopify?.customerPrivacy) return resolve(shopify.customerPrivacy);
    if (!shopify?.loadFeatures) return resolve(null);
    shopify.loadFeatures([{ name: "consent-tracking-api", version: "0.1" }], (error) =>
      resolve(error ? null : (window.Shopify?.customerPrivacy ?? null)),
    );
  });
}

/**
 * কুকির সম্মতি নেয় আর Shopify-কে জানায় (Customer Privacy API), তাই Shopify-র পিক্সেল,
 * আমাদের অ্যানালিটিক্স আর অন্য অ্যাপ সবাই সেই সিদ্ধান্ত মানে।
 * Shopify-র নিজের ব্যানার থাকলে এটা দেখায় না।
 */
export async function mount({ settings }: ToolContext) {
  const s = settings as unknown as Settings;
  if (document.querySelector(SHOPIFY_BANNER)) return;
  const privacy = await loadPrivacyApi();
  if (!privacy) return;
  if (s.onlyWhereRequired && privacy.shouldShowBanner && !privacy.shouldShowBanner()) return;
  const consent = privacy.currentVisitorConsent?.() ?? {};
  if (Object.values(consent).some((v) => v === "yes" || v === "no")) return;

  const host = document.createElement("div");
  host.id = "app-cookies-banner";
  document.body.appendChild(host);
  const close = () => {
    render(null, host);
    host.remove();
  };
  const decide = (yes: boolean) =>
    privacy.setTrackingConsent(
      { analytics: yes, marketing: yes, preferences: yes, sale_of_data: yes },
      close,
    );

  // Shopify-র ব্যানার পরে এলে আমাদেরটা সরে যায় (দুটো ব্যানার কখনো নয়)
  const watch = new MutationObserver(() => {
    if (document.querySelector(SHOPIFY_BANNER)) {
      watch.disconnect();
      close();
    }
  });
  watch.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => watch.disconnect(), 10_000);

  const button = (primary: boolean) => ({
    minHeight: "44px",
    padding: "0 18px",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "14px",
    border: `1px solid ${s.colors.accent}`,
    background: primary ? s.colors.accent : "transparent",
    color: primary ? s.colors.background : s.colors.accent,
  });

  render(
    <div
      role="region"
      aria-label="Cookie consent"
      style={{
        position: "fixed",
        left: "12px",
        right: "12px",
        [s.position]: "12px",
        zIndex: 2147483200,
        maxWidth: "960px",
        margin: "0 auto",
        padding: "16px",
        borderRadius: "12px",
        background: s.colors.background,
        color: s.colors.text,
        boxShadow: "0 8px 30px rgba(0,0,0,.25)",
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: "14px",
      }}
    >
      <p style={{ margin: 0, flex: "1 1 320px" }}>
        {s.message}{" "}
        {s.privacyLink && (
          <a href={s.privacyLink} style={{ color: "inherit" }}>
            {s.privacyText}
          </a>
        )}
      </p>
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="button" style={button(false)} onClick={() => decide(false)}>
          {s.declineText}
        </button>
        <button type="button" style={button(true)} onClick={() => decide(true)}>
          {s.acceptText}
        </button>
      </div>
    </div>,
    host,
  );
}
