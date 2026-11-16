import type { Category } from "@app/tool-sdk";

/** Small line icons drawn in currentColor, so they follow light and dark mode. */
const PATHS: Record<string, string> = {
  conversion: "M5 12h14M13 6l6 6-6 6",
  trust: "M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3zM9 12l2 2 4-4",
  upsell: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  reviews: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z",
  marketing: "M4 10v4h3l6 4V6L7 10H4zM16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11",
  protect: "M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z",
  local:
    "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z",
  ai: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z",
  platform: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  speed: "M12 13l4-4M4.5 18a9 9 0 1115 0",
  bolt: "M13 3L5 13h6l-1 8 8-10h-6l1-8z",
  shield: "M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  chat: "M4 5h16v11H8l-4 4V5z",
  check: "M5 12l4 4L19 6",
  bill: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z",
  mail: "M3 5h18v14H3zM3 6l9 7 9-7",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
};

export function Icon({ name, size = 20 }: { name: Category | keyof typeof PATHS; size?: number }) {
  const d = PATHS[name] ?? PATHS.platform;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="#4F46E5" />
      <rect x="7" y="7" width="8" height="8" rx="2.5" fill="#fff" />
      <rect x="17" y="7" width="8" height="8" rx="2.5" fill="#C7D2FE" />
      <rect x="7" y="17" width="8" height="8" rx="2.5" fill="#C7D2FE" />
      <rect x="17" y="17" width="8" height="8" rx="2.5" fill="#fff" />
    </svg>
  );
}
