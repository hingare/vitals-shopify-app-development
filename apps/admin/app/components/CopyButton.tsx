import { useAppBridge } from "@shopify/app-bridge-react";
import { useT } from "../lib/i18n";

/** লেখা কপি; অ্যাডমিনের ফ্রেমে clipboard বন্ধ থাকলে পুরনো পথে */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({
  text,
  variant = "tertiary",
}: {
  text: string;
  variant?: "primary" | "secondary" | "tertiary";
}) {
  const t = useT();
  const shopify = useAppBridge();
  return (
    <s-button
      variant={variant}
      onClick={() =>
        void copyText(text).then((ok) =>
          shopify.toast.show(t(ok ? "ai.results.copied" : "ai.results.copyFailed"), {
            isError: !ok,
          }),
        )
      }
    >
      {t("ai.results.copy")}
    </s-button>
  );
}
