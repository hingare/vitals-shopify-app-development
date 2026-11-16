"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ChatTexts } from "./ChatPanel";

const loadPanel = () => import("./ChatPanel");
const ChatPanel = lazy(loadPanel);

/**
 * The "Ask a question" button. The chat window's code is only downloaded when someone is about to
 * use it (pointer over the button, focus or a tap), so it costs pages nothing.
 */
export function ChatLauncher({ texts }: { texts: ChatTexts }) {
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Closing the window puts keyboard focus back on the button
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <>
      {!open && (
        <button
          ref={button}
          type="button"
          className="chat-launcher"
          aria-haspopup="dialog"
          onPointerEnter={() => void loadPanel()}
          onFocus={() => void loadPanel()}
          onClick={() => {
            setUsed(true);
            setOpen(true);
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
          {texts.open}
        </button>
      )}
      {used && (
        <Suspense fallback={null}>
          <ChatPanel texts={texts} open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
