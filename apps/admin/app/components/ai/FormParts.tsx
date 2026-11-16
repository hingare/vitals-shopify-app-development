import { useAppBridge } from "@shopify/app-bridge-react";
import { useT } from "../../lib/i18n";
import type { MediaPrices } from "../../lib/ai/media/models";

/** AI টুলের ফর্মের সাধারণ অংশ (প্রোডাক্ট বাছা, বাড়তি কথা, বাছাই, শুরুর বোতাম) */

/** একটা AI কাজ শুরু করার অনুরোধ: টুলের ইনপুট, তালিকায় দেখানোর নাম */
export interface StartRequest {
  input: Record<string, unknown>;
  label?: string;
}

export interface Picked {
  id: string;
  title: string;
}

export function ProductPicker({
  value,
  onChange,
  optional = false,
}: {
  value: Picked | null;
  onChange: (value: Picked | null) => void;
  optional?: boolean;
}) {
  const t = useT();
  const shopify = useAppBridge();
  const pick = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: false,
      filter: { variants: false },
    });
    const product = selected?.[0];
    if (product) onChange({ id: product.id, title: product.title });
  };
  return (
    <s-stack direction="block" gap="small-200">
      <s-text>{t(optional ? "ai.form.productOptional" : "ai.form.product")}</s-text>
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-button onClick={() => void pick()}>
          {value ? t("ai.form.changeProduct") : t("ai.form.chooseProduct")}
        </s-button>
        {value && <s-text>{value.title}</s-text>}
        {value && optional && (
          <s-button variant="tertiary" onClick={() => onChange(null)}>
            {t("ai.form.clear")}
          </s-button>
        )}
      </s-stack>
    </s-stack>
  );
}

export function Notes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <s-text-area
      label={t("ai.form.notes")}
      details={t("ai.form.notesHelp")}
      rows={2}
      maxLength={500}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}

export function Choice<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: readonly V[];
  onChange: (v: V) => void;
}) {
  const t = useT();
  return (
    <s-select label={label} value={value} onChange={(e) => onChange(e.currentTarget.value as V)}>
      {options.map((o) => (
        <s-option key={o} value={o}>
          {t(`ai.option.${o}`)}
        </s-option>
      ))}
    </s-select>
  );
}

export function Checks<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V[];
  options: readonly V[];
  onChange: (v: V[]) => void;
}) {
  const t = useT();
  return (
    <s-stack direction="block" gap="small-200">
      <s-text>{label}</s-text>
      {options.map((o) => (
        <s-checkbox
          key={o}
          label={t(`ai.option.${o}`)}
          checked={value.includes(o)}
          onChange={(e) =>
            onChange(
              e.currentTarget.checked
                ? options.filter((x) => x === o || value.includes(x))
                : value.filter((x) => x !== o),
            )
          }
        />
      ))}
    </s-stack>
  );
}

export function StartButton({
  disabled,
  busy,
  onClick,
  label,
}: {
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
  label?: string;
}) {
  const t = useT();
  return (
    <s-stack direction="inline">
      <s-button
        variant="primary"
        onClick={onClick}
        {...(busy ? { loading: true } : {})}
        {...(disabled ? { disabled: true } : {})}
      >
        {label ?? t("ai.form.generate")}
      </s-button>
    </s-stack>
  );
}

export type { MediaPrices };

export interface FormProps {
  busy: boolean;
  disabled: boolean;
  storeUrl: string;
  media?: MediaPrices | null;
  onStart: (request: StartRequest) => void;
}
