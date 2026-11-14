import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { GenerationView } from "../../lib/ai/studio.server";
import { useT } from "../../lib/i18n";

/**
 * AI-র ফল দেখা আর বদলানো। স্টোরে বসানোর টুলগুলোতে (বর্ণনা, alt, FAQ, পেজ, প্রোডাক্ট) মার্চেন্ট লেখা বদলে
 * তারপর বসান; বাকিগুলো (পোস্ট, প্ল্যান, ক্যাম্পেইন, অডিট) কপি করে নিজের জায়গায় ব্যবহার করেন।
 * বদলানো লেখা `drafts`-এ থাকে, আর "বসান" চাপলে সেটাই যায় (সার্ভার আবার যাচাই করে)।
 */
export type Output = Record<string, unknown>;
export type ResultAction = Record<string, unknown> & { intent: string };

const str = (value: unknown) => (typeof value === "string" ? value : "");
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // অ্যাডমিনের ফ্রেমে clipboard বন্ধ থাকলে পুরনো পথ
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

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const shopify = useAppBridge();
  return (
    <s-button
      variant="tertiary"
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

interface ViewProps {
  input: Output;
  output: Output;
  editable: boolean;
  onChange: (output: Output) => void;
}

function DescriptionView({ input, output, editable, onChange }: ViewProps) {
  const t = useT();
  const set = (patch: Output) => onChange({ ...output, ...patch });
  return (
    <s-stack direction="block" gap="base">
      <s-text-area
        label={t("ai.results.description")}
        details={t("ai.results.formatHelp")}
        rows={10}
        maxLength={6000}
        readOnly={!editable}
        value={str(output.description)}
        onChange={(e) => set({ description: e.currentTarget.value })}
      />
      {input.includeSeo !== false && (
        <>
          <s-text-field
            label={t("ai.results.seoTitle")}
            maxLength={70}
            readOnly={!editable}
            value={str(output.seoTitle)}
            onChange={(e) => set({ seoTitle: e.currentTarget.value })}
          />
          <s-text-area
            label={t("ai.results.seoDescription")}
            rows={2}
            maxLength={320}
            readOnly={!editable}
            value={str(output.seoDescription)}
            onChange={(e) => set({ seoDescription: e.currentTarget.value })}
          />
        </>
      )}
    </s-stack>
  );
}

function AltView({ input, output, editable, onChange }: ViewProps) {
  const t = useT();
  const image = str(input.imageUrl);
  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      {image && <s-thumbnail src={image} alt={str(output.alt)} size="base" />}
      <s-box inlineSize="100%" maxInlineSize="560px">
        <s-text-field
          label={t("ai.results.alt")}
          maxLength={512}
          readOnly={!editable}
          value={str(output.alt)}
          onChange={(e) => onChange({ alt: e.currentTarget.value })}
        />
      </s-box>
    </s-stack>
  );
}

interface FaqItem {
  question: string;
  answer: string;
}

function FaqView({ output, editable, onChange }: ViewProps) {
  const t = useT();
  const items = list<FaqItem>(output.items);
  const update = (index: number, patch: Partial<FaqItem>) =>
    onChange({ items: items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  return (
    <s-stack direction="block" gap="base">
      {items.map((item, index) => (
        <s-stack key={index} direction="block" gap="small-200">
          <s-text-field
            label={t("ai.results.question", { n: index + 1 })}
            maxLength={200}
            readOnly={!editable}
            value={str(item.question)}
            onChange={(e) => update(index, { question: e.currentTarget.value })}
          />
          <s-text-area
            label={t("ai.results.answer")}
            rows={3}
            maxLength={1000}
            readOnly={!editable}
            value={str(item.answer)}
            onChange={(e) => update(index, { answer: e.currentTarget.value })}
          />
          {editable && items.length > 1 && (
            <s-stack direction="inline">
              <s-button
                variant="tertiary"
                tone="critical"
                onClick={() => onChange({ items: items.filter((_, i) => i !== index) })}
              >
                {t("ai.results.remove")}
              </s-button>
            </s-stack>
          )}
          {index < items.length - 1 && <s-divider />}
        </s-stack>
      ))}
    </s-stack>
  );
}

interface Post {
  platform: string;
  text: string;
  hashtags?: string[];
}

const postText = (post: Post) => {
  const tags = (post.hashtags ?? []).map((tag) => `#${tag}`).join(" ");
  return tags ? `${post.text}\n\n${tags}` : post.text;
};

function PostsView({ output, onChange }: ViewProps) {
  const t = useT();
  const posts = list<Post>(output.posts);
  return (
    <s-stack direction="block" gap="base">
      {posts.map((post, index) => (
        <s-stack key={index} direction="block" gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge>{t(`ai.option.${post.platform}`)}</s-badge>
            <CopyButton text={postText(post)} />
          </s-stack>
          <s-text-area
            label={t("ai.results.post")}
            labelAccessibilityVisibility="exclusive"
            rows={5}
            maxLength={2200}
            value={str(post.text)}
            onChange={(e) =>
              onChange({
                posts: posts.map((p, i) =>
                  i === index ? { ...p, text: e.currentTarget.value } : p,
                ),
              })
            }
          />
          {(post.hashtags?.length ?? 0) > 0 && (
            <s-text color="subdued">{post.hashtags!.map((tag) => `#${tag}`).join(" ")}</s-text>
          )}
        </s-stack>
      ))}
    </s-stack>
  );
}

interface Week {
  title: string;
  focus: string;
  tasks: Array<{ day: string; channel: string; task: string }>;
}

const planText = (output: Output) =>
  [
    str(output.summary),
    ...list<Week>(output.weeks).map(
      (week) =>
        `${week.title}\n${week.focus}\n${list<Week["tasks"][number]>(week.tasks)
          .map((task) => `- ${task.day} · ${task.channel}: ${task.task}`)
          .join("\n")}`,
    ),
    list<string>(output.metrics)
      .map((metric) => `- ${metric}`)
      .join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

function PlanView({ output }: ViewProps) {
  const t = useT();
  const metrics = list<string>(output.metrics);
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline">
        <CopyButton text={planText(output)} />
      </s-stack>
      <s-paragraph>{str(output.summary)}</s-paragraph>
      {list<Week>(output.weeks).map((week, index) => (
        <s-stack key={index} direction="block" gap="small-200">
          <s-heading>{week.title}</s-heading>
          <s-text color="subdued">{week.focus}</s-text>
          <s-unordered-list>
            {list<Week["tasks"][number]>(week.tasks).map((task, i) => (
              <s-list-item key={i}>
                <s-text type="strong">
                  {task.day} · {task.channel}:
                </s-text>{" "}
                {task.task}
              </s-list-item>
            ))}
          </s-unordered-list>
        </s-stack>
      ))}
      {metrics.length > 0 && (
        <s-stack direction="block" gap="small-200">
          <s-heading>{t("ai.results.metrics")}</s-heading>
          <s-unordered-list>
            {metrics.map((metric, i) => (
              <s-list-item key={i}>{metric}</s-list-item>
            ))}
          </s-unordered-list>
        </s-stack>
      )}
    </s-stack>
  );
}

interface Email {
  subject: string;
  body: string;
}

const campaignText = (output: Output) =>
  [
    str(output.name),
    str(output.hook),
    list<string>(output.steps)
      .map((step, i) => `${i + 1}. ${step}`)
      .join("\n"),
    list<string>(output.rules)
      .map((rule) => `- ${rule}`)
      .join("\n"),
    ...list<Post>(output.posts).map((post) => `${post.platform}:\n${post.text}`),
    ...list<Email>(output.emails).map((email) => `${email.subject}\n\n${email.body}`),
  ]
    .filter(Boolean)
    .join("\n\n");

function CampaignView({ output }: ViewProps) {
  const t = useT();
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline">
        <CopyButton text={campaignText(output)} />
      </s-stack>
      <s-heading>{str(output.name)}</s-heading>
      <s-paragraph>{str(output.hook)}</s-paragraph>
      <s-heading>{t("ai.results.steps")}</s-heading>
      <s-ordered-list>
        {list<string>(output.steps).map((step, i) => (
          <s-list-item key={i}>{step}</s-list-item>
        ))}
      </s-ordered-list>
      <s-heading>{t("ai.results.rules")}</s-heading>
      <s-unordered-list>
        {list<string>(output.rules).map((rule, i) => (
          <s-list-item key={i}>{rule}</s-list-item>
        ))}
      </s-unordered-list>
      <s-heading>{t("ai.results.posts")}</s-heading>
      {list<Post>(output.posts).map((post, i) => (
        <s-stack key={i} direction="block" gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge>{t(`ai.option.${post.platform}`)}</s-badge>
            <CopyButton text={post.text} />
          </s-stack>
          <s-paragraph>{post.text}</s-paragraph>
        </s-stack>
      ))}
      <s-heading>{t("ai.results.emails")}</s-heading>
      {list<Email>(output.emails).map((email, i) => (
        <s-stack key={i} direction="block" gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text type="strong">{email.subject}</s-text>
            <CopyButton text={`${email.subject}\n\n${email.body}`} />
          </s-stack>
          <s-paragraph>{email.body}</s-paragraph>
        </s-stack>
      ))}
    </s-stack>
  );
}

interface Issue {
  priority: "high" | "medium" | "low";
  area: string;
  problem: string;
  fix: string;
}

const PRIORITY_TONE = { high: "critical", medium: "warning", low: "neutral" } as const;

function AuditView({ output }: ViewProps) {
  const t = useT();
  const score = typeof output.score === "number" ? output.score : 0;
  const tone = score >= 80 ? "success" : score >= 50 ? "warning" : "critical";
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-heading>{t("ai.results.score", { score })}</s-heading>
        <s-badge tone={tone}>{t(`ai.results.score.${tone}`)}</s-badge>
      </s-stack>
      <s-paragraph>{str(output.summary)}</s-paragraph>
      {list<Issue>(output.issues).map((issue, i) => (
        <s-stack key={i} direction="block" gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone={PRIORITY_TONE[issue.priority] ?? "neutral"}>
              {t(`ai.results.priority.${issue.priority}`)}
            </s-badge>
            <s-text color="subdued">{t(`ai.results.area.${issue.area}`)}</s-text>
          </s-stack>
          <s-text type="strong">{issue.problem}</s-text>
          <s-text>{issue.fix}</s-text>
        </s-stack>
      ))}
    </s-stack>
  );
}

interface PageSection {
  heading: string;
  body: string;
}

function PageView({ output, editable, onChange }: ViewProps) {
  const t = useT();
  const sections = list<PageSection>(output.sections);
  const update = (index: number, patch: Partial<PageSection>) =>
    onChange({
      ...output,
      sections: sections.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  return (
    <s-stack direction="block" gap="base">
      <s-text-field
        label={t("ai.results.pageTitle")}
        maxLength={120}
        readOnly={!editable}
        value={str(output.title)}
        onChange={(e) => onChange({ ...output, title: e.currentTarget.value })}
      />
      {sections.map((section, index) => (
        <s-stack key={index} direction="block" gap="small-200">
          <s-divider />
          <s-text-field
            label={t("ai.results.sectionHeading")}
            maxLength={120}
            readOnly={!editable}
            value={str(section.heading)}
            onChange={(e) => update(index, { heading: e.currentTarget.value })}
          />
          <s-text-area
            label={t("ai.results.sectionBody")}
            details={index === 0 ? t("ai.results.formatHelp") : undefined}
            rows={6}
            maxLength={4000}
            readOnly={!editable}
            value={str(section.body)}
            onChange={(e) => update(index, { body: e.currentTarget.value })}
          />
          {editable && sections.length > 1 && (
            <s-stack direction="inline">
              <s-button
                variant="tertiary"
                tone="critical"
                onClick={() =>
                  onChange({ ...output, sections: sections.filter((_, i) => i !== index) })
                }
              >
                {t("ai.results.removeSection")}
              </s-button>
            </s-stack>
          )}
        </s-stack>
      ))}
    </s-stack>
  );
}

function ImportView({ output, editable, onChange }: ViewProps) {
  const t = useT();
  const set = (patch: Output) => onChange({ ...output, ...patch });
  const images = list<string>(output.images);
  const [tags, setTags] = useState(list<string>(output.tags).join(", "));
  return (
    <s-stack direction="block" gap="base">
      {images.length > 0 && (
        <s-stack direction="inline" gap="small-200" alignItems="center">
          {images.map((src, index) => (
            <s-stack key={src} direction="block" gap="small-100" alignItems="center">
              <s-thumbnail src={src} alt={str(output.title)} size="base" />
              {editable && (
                <s-button
                  variant="tertiary"
                  tone="critical"
                  onClick={() => set({ images: images.filter((_, i) => i !== index) })}
                >
                  {t("ai.results.remove")}
                </s-button>
              )}
            </s-stack>
          ))}
        </s-stack>
      )}
      <s-text-field
        label={t("ai.results.productTitle")}
        maxLength={255}
        readOnly={!editable}
        value={str(output.title)}
        onChange={(e) => set({ title: e.currentTarget.value })}
      />
      <s-text-area
        label={t("ai.results.description")}
        details={t("ai.results.formatHelp")}
        rows={8}
        maxLength={6000}
        readOnly={!editable}
        value={str(output.description)}
        onChange={(e) => set({ description: e.currentTarget.value })}
      />
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
        <s-text-field
          label={t("ai.results.vendor")}
          maxLength={255}
          readOnly={!editable}
          value={str(output.vendor)}
          onChange={(e) => set({ vendor: e.currentTarget.value })}
        />
        <s-text-field
          label={t("ai.results.productType")}
          maxLength={255}
          readOnly={!editable}
          value={str(output.productType)}
          onChange={(e) => set({ productType: e.currentTarget.value })}
        />
        <s-text-field
          label={t("ai.results.price")}
          details={t("ai.results.priceHelp")}
          maxLength={13}
          readOnly={!editable}
          value={str(output.price)}
          onChange={(e) => set({ price: e.currentTarget.value.trim() })}
        />
        <s-text-field
          label={t("ai.results.tags")}
          details={t("ai.results.tagsHelp")}
          readOnly={!editable}
          value={tags}
          onChange={(e) => {
            const value = e.currentTarget.value;
            setTags(value);
            set({
              tags: value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean)
                .slice(0, 20),
            });
          }}
        />
      </s-grid>
    </s-stack>
  );
}

const VIEWS: Record<string, (props: ViewProps) => React.JSX.Element> = {
  "ai-descriptions": DescriptionView,
  "ai-alt-text": AltView,
  "ai-product-faq": FaqView,
  "ai-social-posts": PostsView,
  "ai-marketing-plan": PlanView,
  "ai-viral-campaign": CampaignView,
  "ai-page-audit": AuditView,
  "ai-page-builder": PageView,
  "ai-product-importer": ImportView,
};

const STATUS_TONE = {
  queued: "neutral",
  running: "info",
  ready: "info",
  applying: "info",
  applied: "success",
  undoing: "info",
  undone: "neutral",
  failed: "critical",
  discarded: "neutral",
} as const;

const APPLY_LABEL: Record<string, string> = {
  "ai-page-builder": "ai.results.applyPage",
  "ai-product-importer": "ai.results.applyProduct",
};

const APPLIED_NOTE: Record<string, string> = {
  "ai-page-builder": "ai.results.appliedPage",
  "ai-product-importer": "ai.results.appliedProduct",
};

function ResultCard({
  toolId,
  generation,
  draft,
  onDraft,
  busy,
  onAction,
}: {
  toolId: string;
  generation: GenerationView;
  draft: Output | undefined;
  onDraft: (output: Output) => void;
  busy: boolean;
  onAction: (action: ResultAction) => void;
}) {
  const t = useT();
  const status = generation.status as keyof typeof STATUS_TONE;
  const working = ["queued", "running", "applying", "undoing"].includes(status);
  const output = draft ?? generation.output;
  const editable = generation.canApply && (status === "ready" || status === "undone");
  const View = VIEWS[toolId];
  const id = generation.id;
  return (
    <s-section heading={generation.label || t(`tool.${toolId}.name`)}>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-badge tone={STATUS_TONE[status] ?? "neutral"}>{t(`ai.status.${status}`)}</s-badge>
          <s-text color="subdued">
            {new Date(generation.createdAt).toLocaleString()}
            {generation.credits > 0 && ` · ${t("ai.results.credits", { n: generation.credits })}`}
          </s-text>
          {generation.adminLink && (
            <s-link href={generation.adminLink} target="_top">
              {t("ai.results.openInShopify")}
            </s-link>
          )}
        </s-stack>

        {working && (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-spinner size="base" accessibilityLabel={t(`ai.status.${status}`)} />
            <s-text color="subdued">{t("ai.results.working")}</s-text>
          </s-stack>
        )}
        {status === "failed" && (
          <s-banner tone="critical">{t(`ai.error.${generation.error ?? "failed"}`)}</s-banner>
        )}
        {status === "applied" && APPLIED_NOTE[toolId] && (
          <s-banner tone="success">{t(APPLIED_NOTE[toolId])}</s-banner>
        )}
        {!working && status !== "failed" && output && View && (
          <View input={generation.input} output={output} editable={editable} onChange={onDraft} />
        )}

        {!working && (
          <s-stack direction="inline" gap="small-200">
            {editable && (
              <s-button
                variant="primary"
                {...(busy ? { disabled: true } : {})}
                onClick={() =>
                  onAction({ intent: "apply", id, ...(draft ? { output: draft } : {}) })
                }
              >
                {t(APPLY_LABEL[toolId] ?? "ai.results.apply")}
              </s-button>
            )}
            {status === "applied" && generation.canUndo && (
              <s-button
                {...(busy ? { disabled: true } : {})}
                onClick={() => onAction({ intent: "undo", id })}
              >
                {t("ai.results.undo")}
              </s-button>
            )}
            {status === "failed" && (
              <s-button
                {...(busy ? { disabled: true } : {})}
                onClick={() => onAction({ intent: "retry", id })}
              >
                {t("ai.results.retry")}
              </s-button>
            )}
            {(status === "ready" || status === "failed" || status === "undone") && (
              <s-button
                variant="tertiary"
                {...(busy ? { disabled: true } : {})}
                onClick={() => onAction({ intent: "discard", id })}
              >
                {t("ai.results.discard")}
              </s-button>
            )}
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

export function AiResults({
  toolId,
  generations,
  busy,
  onAction,
}: {
  toolId: string;
  generations: GenerationView[];
  busy: boolean;
  onAction: (action: ResultAction) => void;
}) {
  const t = useT();
  const [drafts, setDrafts] = useState<Record<string, Output>>({});
  const ready = generations.filter((g) => g.status === "ready" && g.canApply);

  if (generations.length === 0) {
    return (
      <s-section heading={t("ai.results.title")}>
        <s-paragraph>{t("ai.results.empty")}</s-paragraph>
      </s-section>
    );
  }

  return (
    <>
      {ready.length > 1 && (
        <s-banner tone="info">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text>{t("ai.results.readyMany", { n: ready.length })}</s-text>
            <s-button
              {...(busy ? { disabled: true } : {})}
              onClick={() =>
                onAction({
                  intent: "applyAll",
                  edits: Object.fromEntries(
                    ready.filter((g) => drafts[g.id]).map((g) => [g.id, drafts[g.id]]),
                  ),
                })
              }
            >
              {t("ai.results.applyAll")}
            </s-button>
          </s-stack>
        </s-banner>
      )}
      {generations.map((generation) => (
        <ResultCard
          key={generation.id}
          toolId={toolId}
          generation={generation}
          draft={drafts[generation.id]}
          onDraft={(output) => setDrafts((all) => ({ ...all, [generation.id]: output }))}
          busy={busy}
          onAction={onAction}
        />
      ))}
    </>
  );
}
