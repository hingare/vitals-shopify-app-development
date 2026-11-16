import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useT } from "../../lib/i18n";
import {
  EXPAND_SHAPES,
  MOTION_IDS,
  SCENE_IDS,
  SHOT_SHAPES,
  alreadyShape,
  upscaleAllowed,
  type ExpandShape,
  type ShotShape,
} from "../../lib/ai/media/models";
import type { ProductImagesData } from "../../routes/app.ai.images";
import {
  Choice,
  Notes,
  ProductPicker,
  StartButton,
  type FormProps,
  type MediaPrices,
  type Picked,
} from "./FormParts";

/**
 * ছবি ও ভিডিওর AI টুলের ফর্ম: প্রোডাক্ট বাছা, তার ছবি বাছা, টুলের বিকল্প, আর শুরুর আগেই খরচ (ক্রেডিটে)।
 * পটভূমি সরানোয় একসাথে কয়েকটা ছবি নেওয়া যায়, বাকিগুলোয় একটা।
 */
type ProductImage = ProductImagesData["images"][number];

function useProductImages(product: Picked | null) {
  const fetcher = useFetcher<ProductImagesData>();
  const { load } = fetcher;
  const productId = product?.id ?? null;
  useEffect(() => {
    if (productId) void load(`/app/ai/images?product=${encodeURIComponent(productId)}`);
  }, [productId, load]);
  const images = productId && fetcher.data?.product === productId ? fetcher.data.images : [];
  return { images, loading: Boolean(productId) && fetcher.state !== "idle" };
}

/** মার্চেন্ট এই প্রোডাক্টে নিজে কিছু না বাছা পর্যন্ত প্রথম ছবিটা বাছা থাকে */
function useSelection(productId: string | null, images: ProductImage[]) {
  const [chosen, setChosen] = useState<{ productId: string; ids: string[] } | null>(null);
  const selected =
    chosen && chosen.productId === productId
      ? chosen.ids.filter((id) => images.some((image) => image.id === id))
      : images[0]
        ? [images[0].id]
        : [];
  const setSelected = useCallback(
    (ids: string[]) => {
      if (productId) setChosen({ productId, ids });
    },
    [productId],
  );
  return [selected, setSelected] as const;
}

function ImagePicker({
  images,
  loading,
  selected,
  multiple,
  onChange,
}: {
  images: ProductImage[];
  loading: boolean;
  selected: string[];
  multiple: boolean;
  onChange: (ids: string[]) => void;
}) {
  const t = useT();
  if (loading) {
    return <s-spinner size="base" accessibilityLabel={t("ai.media.loadingImages")} />;
  }
  if (images.length === 0) return <s-text color="subdued">{t("ai.media.noImages")}</s-text>;
  return (
    <s-stack direction="block" gap="small-200">
      <s-text>{t(multiple ? "ai.media.pickImages" : "ai.media.pickImage")}</s-text>
      <s-stack direction="inline" gap="base">
        {images.map((image) => (
          <s-stack key={image.id} direction="block" gap="small-100" alignItems="center">
            <s-thumbnail src={image.url} alt={`#${image.position}`} size="large" />
            <s-checkbox
              label={`#${image.position}`}
              {...(image.width && image.height
                ? { details: `${image.width} × ${image.height}` }
                : {})}
              checked={selected.includes(image.id)}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                if (multiple) {
                  onChange(on ? [...selected, image.id] : selected.filter((id) => id !== image.id));
                } else {
                  onChange(on ? [image.id] : []);
                }
              }}
            />
          </s-stack>
        ))}
      </s-stack>
    </s-stack>
  );
}

function Cost({ credits, upTo = false }: { credits: number; upTo?: boolean }) {
  const t = useT();
  if (credits <= 0) return null;
  return (
    <s-text color="subdued">
      {t(upTo ? "ai.media.costUpTo" : "ai.media.cost", { n: credits })}
    </s-text>
  );
}

type Length = "short" | "long";

function LengthChoice({
  media,
  value,
  onChange,
}: {
  media: MediaPrices | null | undefined;
  value: Length;
  onChange: (value: Length) => void;
}) {
  const t = useT();
  return (
    <s-select
      label={t("ai.media.length")}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value as Length)}
    >
      {(["short", "long"] as const).map((length) => (
        <s-option key={length} value={length}>
          {t("ai.media.seconds", { n: media?.seconds?.[length] ?? 0 })}
        </s-option>
      ))}
    </s-select>
  );
}

/** ছবিটা ঠিক করে দেওয়ার মতো সাধারণ অংশ: প্রোডাক্ট আর ছবি */
function useImageForm() {
  const [product, setProduct] = useState<Picked | null>(null);
  const { images, loading } = useProductImages(product);
  const [selected, setSelected] = useSelection(product?.id ?? null, images);
  return { product, setProduct, images, loading, selected, setSelected };
}

function BackgroundForm({ busy, disabled, media, onStart }: FormProps) {
  const t = useT();
  const form = useImageForm();
  const [background, setBackground] = useState<"transparent" | "white">("transparent");
  const count = Math.max(1, form.selected.length);
  return (
    <s-stack direction="block" gap="base">
      <ProductPicker value={form.product} onChange={form.setProduct} />
      {form.product && (
        <ImagePicker
          images={form.images}
          loading={form.loading}
          selected={form.selected}
          multiple
          onChange={form.setSelected}
        />
      )}
      <Choice
        label={t("ai.media.background")}
        value={background}
        options={["transparent", "white"] as const}
        onChange={setBackground}
      />
      <Cost credits={(media?.credits.image ?? 0) * count} />
      <StartButton
        busy={busy}
        disabled={disabled || !form.product || form.selected.length === 0}
        onClick={() =>
          form.product &&
          onStart({
            input: { productId: form.product.id, mediaIds: form.selected, background },
            label: form.product.title,
          })
        }
      />
    </s-stack>
  );
}

function EnhancerForm({ busy, disabled, media, onStart }: FormProps) {
  const t = useT();
  const form = useImageForm();
  const [mode, setMode] = useState<"upscale" | "expand">("upscale");
  const [shape, setShape] = useState<ExpandShape>("1:1");
  const image = form.images.find((item) => item.id === form.selected[0]);
  const blocked = image
    ? mode === "upscale"
      ? !upscaleAllowed(image)
      : alreadyShape(image, shape)
    : false;
  return (
    <s-stack direction="block" gap="base">
      <ProductPicker value={form.product} onChange={form.setProduct} />
      {form.product && (
        <ImagePicker
          images={form.images}
          loading={form.loading}
          selected={form.selected}
          multiple={false}
          onChange={form.setSelected}
        />
      )}
      <Choice
        label={t("ai.media.enhanceMode")}
        value={mode}
        options={["upscale", "expand"] as const}
        onChange={setMode}
      />
      {mode === "expand" && (
        <Choice
          label={t("ai.media.shape")}
          value={shape}
          options={EXPAND_SHAPES}
          onChange={setShape}
        />
      )}
      {blocked && (
        <s-text tone="caution">
          {t(mode === "upscale" ? "ai.media.alreadyLarge" : "ai.media.alreadyShape")}
        </s-text>
      )}
      <Cost credits={media?.credits[mode] ?? 0} upTo={mode === "upscale"} />
      <StartButton
        busy={busy}
        disabled={disabled || !form.product || !image || blocked}
        onClick={() =>
          form.product &&
          image &&
          onStart({
            input: { productId: form.product.id, mediaIds: [image.id], mode, shape },
            label: form.product.title,
          })
        }
      />
    </s-stack>
  );
}

const SCENE_OPTIONS = [...SCENE_IDS, "custom"] as const;
type SceneOption = (typeof SCENE_OPTIONS)[number];

function PhotoshootForm({ busy, disabled, media, onStart }: FormProps) {
  const t = useT();
  const form = useImageForm();
  const [scene, setScene] = useState<SceneOption>("studio");
  const [customScene, setCustomScene] = useState("");
  const [count, setCount] = useState(2);
  const [shape, setShape] = useState<ShotShape>("square");
  const image = form.images.find((item) => item.id === form.selected[0]);
  const custom = scene === "custom";
  return (
    <s-stack direction="block" gap="base">
      <ProductPicker value={form.product} onChange={form.setProduct} />
      {form.product && (
        <ImagePicker
          images={form.images}
          loading={form.loading}
          selected={form.selected}
          multiple={false}
          onChange={form.setSelected}
        />
      )}
      <Choice
        label={t("ai.media.scene")}
        value={scene}
        options={SCENE_OPTIONS}
        onChange={setScene}
      />
      {custom && (
        <s-text-field
          label={t("ai.media.customScene")}
          details={t("ai.media.customSceneHelp")}
          maxLength={300}
          value={customScene}
          onChange={(e) => setCustomScene(e.currentTarget.value)}
        />
      )}
      <s-number-field
        label={t("ai.media.count")}
        min={1}
        max={4}
        value={String(count)}
        onChange={(e) => setCount(Math.min(4, Math.max(1, Number(e.currentTarget.value) || 1)))}
      />
      <Choice
        label={t("ai.media.shotShape")}
        value={shape}
        options={SHOT_SHAPES}
        onChange={setShape}
      />
      <s-text color="subdued">{t("ai.media.photoshootNote")}</s-text>
      <Cost credits={(media?.credits.image ?? 0) * count} />
      <StartButton
        busy={busy}
        disabled={disabled || !form.product || !image || (custom && customScene.trim().length < 3)}
        onClick={() =>
          form.product &&
          image &&
          onStart({
            input: {
              productId: form.product.id,
              mediaIds: [image.id],
              scene,
              customScene,
              count,
              shape,
            },
            label: form.product.title,
          })
        }
      />
    </s-stack>
  );
}

const MOTION_OPTIONS = [...MOTION_IDS, "custom"] as const;
type MotionOption = (typeof MOTION_OPTIONS)[number];

function VideoForm({ busy, disabled, media, onStart }: FormProps) {
  const t = useT();
  const form = useImageForm();
  const [motion, setMotion] = useState<MotionOption>("push-in");
  const [customMotion, setCustomMotion] = useState("");
  const [length, setLength] = useState<Length>("short");
  const image = form.images.find((item) => item.id === form.selected[0]);
  const custom = motion === "custom";
  return (
    <s-stack direction="block" gap="base">
      <ProductPicker value={form.product} onChange={form.setProduct} />
      {form.product && (
        <ImagePicker
          images={form.images}
          loading={form.loading}
          selected={form.selected}
          multiple={false}
          onChange={form.setSelected}
        />
      )}
      <Choice
        label={t("ai.media.motion")}
        value={motion}
        options={MOTION_OPTIONS}
        onChange={setMotion}
      />
      {custom && (
        <s-text-field
          label={t("ai.media.customMotion")}
          details={t("ai.media.customMotionHelp")}
          maxLength={300}
          value={customMotion}
          onChange={(e) => setCustomMotion(e.currentTarget.value)}
        />
      )}
      <LengthChoice media={media} value={length} onChange={setLength} />
      <s-text color="subdued">{t("ai.media.videoNote")}</s-text>
      <Cost credits={media?.credits[length] ?? 0} />
      <StartButton
        busy={busy}
        disabled={disabled || !form.product || !image || (custom && customMotion.trim().length < 3)}
        onClick={() =>
          form.product &&
          image &&
          onStart({
            input: {
              productId: form.product.id,
              mediaIds: [image.id],
              motion,
              customMotion,
              length,
            },
            label: form.product.title,
          })
        }
      />
    </s-stack>
  );
}

const AD_PLATFORMS = ["facebook", "instagram", "tiktok"] as const;
const AD_GOALS = ["sale", "launch", "awareness"] as const;

function VideoAdsForm({ busy, disabled, media, onStart }: FormProps) {
  const t = useT();
  const form = useImageForm();
  const [platform, setPlatform] = useState<(typeof AD_PLATFORMS)[number]>("facebook");
  const [goal, setGoal] = useState<(typeof AD_GOALS)[number]>("sale");
  const [length, setLength] = useState<Length>("short");
  const [notes, setNotes] = useState("");
  const image = form.images.find((item) => item.id === form.selected[0]);
  return (
    <s-stack direction="block" gap="base">
      <ProductPicker value={form.product} onChange={form.setProduct} />
      {form.product && (
        <ImagePicker
          images={form.images}
          loading={form.loading}
          selected={form.selected}
          multiple={false}
          onChange={form.setSelected}
        />
      )}
      <Choice
        label={t("ai.form.platform")}
        value={platform}
        options={AD_PLATFORMS}
        onChange={setPlatform}
      />
      <Choice label={t("ai.form.goal")} value={goal} options={AD_GOALS} onChange={setGoal} />
      <LengthChoice media={media} value={length} onChange={setLength} />
      <Notes value={notes} onChange={setNotes} />
      <s-text color="subdued">{t("ai.media.videoNote")}</s-text>
      <Cost credits={media?.credits[length] ?? 0} upTo />
      <StartButton
        busy={busy}
        disabled={disabled || !form.product || !image}
        onClick={() =>
          form.product &&
          image &&
          onStart({
            input: {
              productId: form.product.id,
              mediaIds: [image.id],
              platform,
              goal,
              length,
              notes,
            },
            label: form.product.title,
          })
        }
      />
    </s-stack>
  );
}

export const MEDIA_FORMS: Record<string, (props: FormProps) => React.JSX.Element> = {
  "ai-background-remover": BackgroundForm,
  "ai-image-enhancer": EnhancerForm,
  "ai-photoshoots": PhotoshootForm,
  "ai-image-to-video": VideoForm,
  "ai-video-ads": VideoAdsForm,
};
