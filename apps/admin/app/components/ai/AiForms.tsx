import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useT } from "../../lib/i18n";

/** একটা AI কাজ শুরু করার অনুরোধ: টুলের ইনপুট, তালিকায় দেখানোর নাম */
export interface StartRequest {
  input: Record<string, unknown>;
  label?: string;
}

interface Picked {
  id: string;
  title: string;
}

function ProductPicker({
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

function Notes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

function Choice<V extends string>({
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

function Checks<V extends string>({
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

function StartButton({
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

interface FormProps {
  busy: boolean;
  disabled: boolean;
  storeUrl: string;
  onStart: (request: StartRequest) => void;
}

function DescriptionsForm({ busy, disabled, onStart }: FormProps) {
  const t = useT();
  const [product, setProduct] = useState<Picked | null>(null);
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [includeSeo, setIncludeSeo] = useState(true);
  const [notes, setNotes] = useState("");
  return (
    <s-stack direction="block" gap="base">
      <ProductPicker value={product} onChange={setProduct} />
      <Choice
        label={t("ai.form.length")}
        value={length}
        options={["short", "medium", "long"] as const}
        onChange={setLength}
      />
      <s-checkbox
        label={t("ai.form.includeSeo")}
        checked={includeSeo}
        onChange={(e) => setIncludeSeo(e.currentTarget.checked)}
      />
      <Notes value={notes} onChange={setNotes} />
      <StartButton
        busy={busy}
        disabled={disabled || !product}
        onClick={() =>
          product &&
          onStart({ input: { productId: product.id, length, includeSeo, notes }, label: product.title })
        }
      />
    </s-stack>
  );
}

function AltTextForm({ busy, disabled, onStart }: FormProps) {
  const t = useT();
  const [product, setProduct] = useState<Picked | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(true);
  return (
    <s-stack direction="block" gap="base">
      <ProductPicker value={product} onChange={setProduct} />
      <s-checkbox
        label={t("ai.form.onlyMissing")}
        checked={onlyMissing}
        onChange={(e) => setOnlyMissing(e.currentTarget.checked)}
      />
      <StartButton
        busy={busy}
        disabled={disabled || !product}
        onClick={() =>
          product && onStart({ input: { productId: product.id, onlyMissing }, label: product.title })
        }
      />
    </s-stack>
  );
}

function FaqForm({ busy, disabled, onStart }: FormProps) {
  const t = useT();
  const [product, setProduct] = useState<Picked | null>(null);
  const [count, setCount] = useState(5);
  const [notes, setNotes] = useState("");
  return (
    <s-stack direction="block" gap="base">
      <ProductPicker value={product} onChange={setProduct} />
      <s-number-field
        label={t("ai.form.questions")}
        min={3}
        max={8}
        value={String(count)}
        onChange={(e) => setCount(Math.min(8, Math.max(3, Number(e.currentTarget.value) || 5)))}
      />
      <Notes value={notes} onChange={setNotes} />
      <StartButton
        busy={busy}
        disabled={disabled || !product}
        onClick={() =>
          product && onStart({ input: { productId: product.id, count, notes }, label: product.title })
        }
      />
    </s-stack>
  );
}

const PLATFORMS = ["facebook", "instagram", "tiktok", "x"] as const;

function SocialForm({ busy, disabled, onStart }: FormProps) {
  const t = useT();
  const [product, setProduct] = useState<Picked | null>(null);
  const [topic, setTopic] = useState("");
  const [platforms, setPlatforms] = useState<Array<(typeof PLATFORMS)[number]>>([
    "facebook",
    "instagram",
  ]);
  const [goal, setGoal] = useState<"launch" | "sale" | "engagement" | "traffic">("traffic");
  const [notes, setNotes] = useState("");
  return (
    <s-stack direction="block" gap="base">
      <ProductPicker value={product} onChange={setProduct} optional />
      <s-text-field
        label={t("ai.form.topic")}
        details={t("ai.form.topicHelp")}
        maxLength={300}
        value={topic}
        onChange={(e) => setTopic(e.currentTarget.value)}
      />
      <Checks label={t("ai.form.platforms")} value={platforms} options={PLATFORMS} onChange={setPlatforms} />
      <Choice
        label={t("ai.form.goal")}
        value={goal}
        options={["traffic", "sale", "launch", "engagement"] as const}
        onChange={setGoal}
      />
      <Notes value={notes} onChange={setNotes} />
      <StartButton
        busy={busy}
        disabled={disabled || (!product && !topic.trim()) || platforms.length === 0}
        onClick={() =>
          onStart({
            input: { ...(product ? { productId: product.id } : {}), topic, platforms, goal, notes },
            label: product?.title ?? topic.slice(0, 80),
          })
        }
      />
    </s-stack>
  );
}

const CHANNELS = ["email", "social", "ads", "seo", "influencers"] as const;

function PlanForm({ busy, disabled, onStart }: FormProps) {
  const t = useT();
  const [goal, setGoal] = useState<"sales" | "new-customers" | "repeat" | "awareness">("sales");
  const [budget, setBudget] = useState<"none" | "small" | "medium">("small");
  const [channels, setChannels] = useState<Array<(typeof CHANNELS)[number]>>(["email", "social"]);
  const [notes, setNotes] = useState("");
  return (
    <s-stack direction="block" gap="base">
      <Choice
        label={t("ai.form.goal")}
        value={goal}
        options={["sales", "new-customers", "repeat", "awareness"] as const}
        onChange={setGoal}
      />
      <Choice
        label={t("ai.form.budget")}
        value={budget}
        options={["none", "small", "medium"] as const}
        onChange={setBudget}
      />
      <Checks label={t("ai.form.channels")} value={channels} options={CHANNELS} onChange={setChannels} />
      <Notes value={notes} onChange={setNotes} />
      <StartButton
        busy={busy}
        disabled={disabled || channels.length === 0}
        onClick={() => onStart({ input: { goal, budget, channels, notes } })}
      />
    </s-stack>
  );
}

function CampaignForm({ busy, disabled, onStart }: FormProps) {
  const t = useT();
  const [product, setProduct] = useState<Picked | null>(null);
  const [goal, setGoal] = useState<"sales" | "followers" | "emails">("sales");
  const [notes, setNotes] = useState("");
  return (
    <s-stack direction="block" gap="base">
      <ProductPicker value={product} onChange={setProduct} optional />
      <Choice
        label={t("ai.form.goal")}
        value={goal}
        options={["sales", "followers", "emails"] as const}
        onChange={setGoal}
      />
      <Notes value={notes} onChange={setNotes} />
      <StartButton
        busy={busy}
        disabled={disabled}
        onClick={() =>
          onStart({
            input: { ...(product ? { productId: product.id } : {}), goal, notes },
            ...(product ? { label: product.title } : {}),
          })
        }
      />
    </s-stack>
  );
}

function AuditForm({ busy, disabled, storeUrl, onStart }: FormProps) {
  const t = useT();
  const [url, setUrl] = useState(storeUrl);
  return (
    <s-stack direction="block" gap="base">
      <s-url-field
        label={t("ai.form.pageUrl")}
        details={t("ai.form.pageUrlHelp")}
        value={url}
        onChange={(e) => setUrl(e.currentTarget.value)}
      />
      <StartButton
        busy={busy}
        disabled={disabled || !url.trim()}
        onClick={() => onStart({ input: { url }, label: url })}
      />
    </s-stack>
  );
}

const PAGE_TYPES = ["landing", "about", "faq", "size-guide", "shipping", "story"] as const;

function PageBuilderForm({ busy, disabled, onStart }: FormProps) {
  const t = useT();
  const [topic, setTopic] = useState("");
  const [pageType, setPageType] = useState<(typeof PAGE_TYPES)[number]>("landing");
  const [notes, setNotes] = useState("");
  return (
    <s-stack direction="block" gap="base">
      <Choice label={t("ai.form.pageType")} value={pageType} options={PAGE_TYPES} onChange={setPageType} />
      <s-text-field
        label={t("ai.form.pageTopic")}
        details={t("ai.form.pageTopicHelp")}
        maxLength={300}
        value={topic}
        onChange={(e) => setTopic(e.currentTarget.value)}
      />
      <Notes value={notes} onChange={setNotes} />
      <StartButton
        busy={busy}
        disabled={disabled || topic.trim().length < 3}
        onClick={() => onStart({ input: { topic, pageType, notes }, label: topic.slice(0, 80) })}
      />
    </s-stack>
  );
}

function ImporterForm({ busy, disabled, onStart }: FormProps) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <s-stack direction="block" gap="base">
      <s-url-field
        label={t("ai.form.importUrl")}
        details={t("ai.form.importUrlHelp")}
        value={url}
        onChange={(e) => setUrl(e.currentTarget.value)}
      />
      <Notes value={notes} onChange={setNotes} />
      <StartButton
        busy={busy}
        disabled={disabled || !/^https:\/\//i.test(url.trim())}
        onClick={() => onStart({ input: { url: url.trim(), notes }, label: url.trim() })}
      />
    </s-stack>
  );
}

const FORMS: Record<string, (props: FormProps) => React.JSX.Element> = {
  "ai-descriptions": DescriptionsForm,
  "ai-alt-text": AltTextForm,
  "ai-product-faq": FaqForm,
  "ai-social-posts": SocialForm,
  "ai-marketing-plan": PlanForm,
  "ai-viral-campaign": CampaignForm,
  "ai-page-audit": AuditForm,
  "ai-page-builder": PageBuilderForm,
  "ai-product-importer": ImporterForm,
};

export function AiToolForm(props: FormProps & { toolId: string }) {
  const Form = FORMS[props.toolId];
  return Form ? <Form {...props} /> : null;
}
