import { useMemo, useState } from "react";
import { fillContent, renderEmail } from "../lib/email-render";
import { useT } from "../lib/i18n";

/** ক্যাম্পেইন আর flow দুটোর জন্যই একই ফর্ম; flow-তে লিংকের ঘর থাকে না (লিংক সিস্টেম নিজে বসায়) */
export interface EditorContent {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  buttonText: string;
  buttonUrl?: string;
  imageUrl?: string;
}

export interface EmailLook {
  shopName: string;
  accent: string;
  postalAddress: string;
}

export function EmailFields({
  content,
  onChange,
  withLinks,
  vars,
  disabled,
}: {
  content: EditorContent;
  onChange: (next: EditorContent) => void;
  withLinks: boolean;
  /** এই ইমেইলে যে নামগুলো বসানো যায়, যেমন "{first_name}, {shop}" */
  vars: string;
  disabled?: boolean;
}) {
  const t = useT();
  const set = (patch: Partial<EditorContent>) => onChange({ ...content, ...patch });
  const off = disabled ? { disabled: true } : {};
  return (
    <s-stack direction="block" gap="base">
      <s-text-field
        label={t("marketing.email.subject")}
        details={t("marketing.email.vars", { vars })}
        maxLength={150}
        required
        value={content.subject}
        onChange={(e) => set({ subject: e.currentTarget.value })}
        {...off}
      />
      <s-text-field
        label={t("marketing.email.preheader")}
        details={t("marketing.email.preheaderHelp")}
        maxLength={150}
        value={content.preheader}
        onChange={(e) => set({ preheader: e.currentTarget.value })}
        {...off}
      />
      <s-text-field
        label={t("marketing.email.heading")}
        maxLength={120}
        value={content.heading}
        onChange={(e) => set({ heading: e.currentTarget.value })}
        {...off}
      />
      <s-text-area
        label={t("marketing.email.body")}
        details={t("marketing.email.bodyHelp")}
        rows={8}
        maxLength={5000}
        value={content.body}
        onChange={(e) => set({ body: e.currentTarget.value })}
        {...off}
      />
      <s-text-field
        label={t("marketing.email.buttonText")}
        maxLength={40}
        value={content.buttonText}
        onChange={(e) => set({ buttonText: e.currentTarget.value })}
        {...off}
      />
      {withLinks && (
        <>
          <s-url-field
            label={t("marketing.email.buttonUrl")}
            details={t("marketing.email.buttonUrlHelp")}
            value={content.buttonUrl ?? ""}
            onChange={(e) => set({ buttonUrl: e.currentTarget.value })}
            {...off}
          />
          <s-url-field
            label={t("marketing.email.imageUrl")}
            details={t("marketing.email.buttonUrlHelp")}
            value={content.imageUrl ?? ""}
            onChange={(e) => set({ imageUrl: e.currentTarget.value })}
            {...off}
          />
        </>
      )}
    </s-stack>
  );
}

const SAMPLE = { first_name: "Alex", product: "Blue T-shirt", order: "#1001" };
const safeUrl = (value: string | undefined) => (/^https:\/\/\S+$/.test(value ?? "") ? value! : "");

/** ক্রেতা যা দেখবেন প্রায় সেটাই (নমুনা নাম বসিয়ে)। iframe-এ স্ক্রিপ্ট চলে না */
export function EmailPreview({
  content,
  look,
  fallbackUrl,
}: {
  content: EditorContent;
  look: EmailLook;
  /** flow-র বাটন যেখানে যাবে তার নমুনা */
  fallbackUrl: string;
}) {
  const t = useT();
  const html = useMemo(() => {
    const filled = fillContent(
      {
        subject: content.subject,
        preheader: content.preheader,
        heading: content.heading,
        body: content.body,
        buttonText: content.buttonText,
        buttonUrl: safeUrl(content.buttonUrl) || fallbackUrl,
        imageUrl: safeUrl(content.imageUrl),
      },
      { shop: look.shopName, ...SAMPLE },
    );
    return renderEmail(filled, { ...look, unsubscribeUrl: "https://example.com/unsubscribe" }).html;
  }, [content, look, fallbackUrl]);

  return (
    <iframe
      title={t("marketing.email.preview")}
      sandbox=""
      srcDoc={html}
      style={{ width: "100%", height: "560px", border: "1px solid #e5e7eb", borderRadius: "8px" }}
    />
  );
}

export function TestSend({ onSend, sending }: { onSend: (to: string) => void; sending: boolean }) {
  const t = useT();
  const [to, setTo] = useState("");
  return (
    <s-stack direction="inline" gap="small" alignItems="end">
      <s-email-field
        label={t("marketing.email.testTo")}
        value={to}
        onChange={(e) => setTo(e.currentTarget.value)}
      />
      <s-button
        onClick={() => to.trim() && onSend(to.trim())}
        {...(sending ? { loading: true } : {})}
      >
        {t("marketing.email.sendTest")}
      </s-button>
    </s-stack>
  );
}
