"use client";

import { useEffect } from "react";

/**
 * PostHog page analytics, only when NEXT_PUBLIC_POSTHOG_KEY is set at build time.
 * It loads after the page is idle, keeps nothing in cookies or local storage (memory only), skips
 * visitors with Do Not Track, and never records sessions. So no cookie banner is needed for it.
 */
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";

export function Analytics() {
  useEffect(() => {
    if (!KEY) return;
    let cancelled = false;
    const start = () => {
      void import("posthog-js").then(({ default: posthog }) => {
        if (cancelled) return;
        posthog.init(KEY, {
          api_host: HOST,
          persistence: "memory",
          person_profiles: "identified_only",
          capture_pageview: "history_change",
          disable_session_recording: true,
          respect_dnt: true,
        });
      });
    };
    if (window.requestIdleCallback) window.requestIdleCallback(start);
    else window.setTimeout(start, 2000);
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
