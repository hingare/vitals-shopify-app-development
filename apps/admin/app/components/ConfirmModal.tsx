import { useCallback, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useT } from "../lib/i18n";

export type ConfirmRequest = {
  /** প্রশ্নটা, যেমন "Delete this offer?" */
  heading: string;
  /** করলে কী হবে, যেমন "This can't be undone." */
  body: ReactNode;
  /** নিশ্চিত করার বোতামের লেখা */
  action: string;
  /** মুছে ফেলার মতো কাজ হলে বোতাম লাল */
  destructive?: boolean;
  /** কাজটা। Promise ফেরালে সেটা শেষ না হওয়া পর্যন্ত বোতাম লোড দেখায়, তারপর ডায়ালগ বন্ধ হয় */
  onConfirm: () => unknown;
};

/**
 * কাজের আগে Shopify অ্যাডমিনের নিজের ডায়ালগে নিশ্চিত হওয়া। ব্রাউজারের window.confirm অ্যাডমিনের ভেতরে
 * বেমানান দেখায় আর Shopify মোবাইল অ্যাপে কাজ নাও করতে পারে। এক পাতায় একটা ডায়ালগই যথেষ্ট:
 * ask() যে প্রশ্ন দেয় সেটাই দেখায়, তাই তালিকার প্রতিটা সারির জন্য আলাদা ডায়ালগ লাগে না।
 * ফেরত পাওয়া modal পাতার যেকোনো জায়গায় একবার বসান।
 */
export function useConfirm(id: string) {
  const shopify = useAppBridge();
  const t = useT();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [pending, setPending] = useState(false);

  const ask = useCallback(
    (next: ConfirmRequest) => {
      // নতুন লেখা পাতায় বসার পরে ডায়ালগ খোলে, আগের প্রশ্ন এক ঝলকও দেখা যায় না
      flushSync(() => setRequest(next));
      void shopify.modal.show(id);
    },
    [id, shopify],
  );

  async function confirm() {
    if (!request) return;
    setPending(true);
    try {
      await request.onConfirm();
    } finally {
      setPending(false);
      // মুছে অন্য পাতায় চলে গেলে ডায়ালগ আগেই সরে যায়
      await shopify.modal.hide(id).catch(() => undefined);
    }
  }

  const modal = (
    <s-modal id={id} heading={request?.heading ?? ""}>
      <s-paragraph>{request?.body}</s-paragraph>
      <s-button
        slot="primary-action"
        variant="primary"
        {...(request?.destructive ? { tone: "critical" as const } : {})}
        {...(pending ? { loading: true } : {})}
        onClick={() => void confirm()}
      >
        {request?.action}
      </s-button>
      <s-button
        slot="secondary-actions"
        commandFor={id}
        command="--hide"
        {...(pending ? { disabled: true } : {})}
      >
        {t("common.cancel")}
      </s-button>
    </s-modal>
  );

  return { ask, modal };
}
