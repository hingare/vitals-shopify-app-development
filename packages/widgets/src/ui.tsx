import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** কয়েকটা উইজেটের একই রকম অংশ: বাটন, ইনপুট আর পপ-আপ ডায়ালগ */
export interface Colors {
  background: string;
  text: string;
  accent: string;
}

export const buttonStyle = (colors: Colors, outlined = false): JSX.CSSProperties => ({
  background: outlined ? "none" : colors.accent,
  color: outlined ? "inherit" : "#fff",
  border: outlined ? `1px solid ${colors.accent}` : 0,
  borderRadius: "8px",
  padding: "12px 18px",
  minHeight: "44px",
  // লিংককেও বাটনের মতো মাপে রাখে (নইলে padding উচ্চতার সাথে যোগ হয়)
  boxSizing: "border-box",
  fontSize: "15px",
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-block",
  textAlign: "center",
  fontFamily: "inherit",
});

export const inputStyle: JSX.CSSProperties = {
  padding: "12px",
  minHeight: "44px",
  borderRadius: "8px",
  border: "1px solid rgba(0,0,0,.3)",
  // ১৬px-এর কম হলে iPhone ইনপুটে জুম করে ফেলে
  fontSize: "16px",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  background: "#fff",
  color: "#111",
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea,select,[tabindex="0"]';

/**
 * পপ-আপ ডায়ালগ: Escape বা বাইরে ক্লিকে বন্ধ হয়, ফোকাস ভেতরে থাকে, বন্ধ হলে আগের জায়গায় ফেরে।
 */
export function Modal({
  label,
  colors,
  onClose,
  closeLabel,
  maxWidth = 420,
  children,
}: {
  label: string;
  colors: Colors;
  onClose: () => void;
  closeLabel: string;
  maxWidth?: number;
  children: ComponentChildren;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const items = () => [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    // প্রথম ইনপুট থাকলে সেখানে, নইলে প্রথম বাটনে
    (items().find((el) => el.tagName === "INPUT") ?? items()[1] ?? items()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab") return;
      const list = items();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      onClick={(event) => event.target === event.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483100,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: `${maxWidth}px`,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          padding: "32px 24px 24px",
          borderRadius: "12px",
          background: colors.background,
          color: colors.text,
          boxShadow: "0 10px 40px rgba(0,0,0,.25)",
          boxSizing: "border-box",
          fontSize: "15px",
          lineHeight: 1.5,
        }}
      >
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          style={{
            position: "absolute",
            top: "6px",
            right: "6px",
            background: "none",
            border: 0,
            color: "inherit",
            fontSize: "24px",
            minWidth: "40px",
            minHeight: "40px",
            cursor: "pointer",
          }}
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

/** পপ-আপের জন্য body-তে একটা ঘর; ফেরত দেওয়া ফাংশন ডাকলে সরে যায় */
export function overlayHost(id: string): { host: HTMLElement; remove: () => void } {
  const host = document.createElement("div");
  host.id = id;
  document.body.appendChild(host);
  return { host, remove: () => host.remove() };
}
