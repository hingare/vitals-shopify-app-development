import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import {
  enabledReviewSettings,
  listReviews,
  moderate,
  productTitles,
  statusCounts,
  syncProductRating,
} from "../lib/reviews.server";
import { REVIEW_STATUSES, type ReviewStatus } from "../lib/reviews";
import { deleteMediaFiles, resolvePendingMedia } from "../lib/review-media.server";
import { useT } from "../lib/i18n";

const PER_PAGE = 25;

function readStatus(value: string | null): ReviewStatus {
  return (REVIEW_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as ReviewStatus)
    : "pending";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const url = new URL(request.url);
  const status = readStatus(url.searchParams.get("status"));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const [{ total, rows }, counts, settings] = await Promise.all([
    listReviews(shop.id, status, page, PER_PAGE),
    statusCounts(shop.id),
    enabledReviewSettings(shop.id),
  ]);
  const [titles, media] = await Promise.all([
    productTitles(
      admin,
      rows.map((r) => r.productId).filter((p): p is string => Boolean(p)),
    ),
    resolvePendingMedia(
      admin,
      rows.flatMap((r) => r.media),
    ),
  ]);
  const mediaUrl = new Map(media.map((m) => [m.id, m.url]));
  return {
    status,
    page,
    hasMore: page * PER_PAGE < total,
    counts,
    toolEnabled: settings !== null,
    reviews: rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      authorName: r.authorName,
      authorEmail: r.authorEmail,
      product: r.productId ? (titles[r.productId] ?? `#${r.productId}`) : null,
      reply: r.reply,
      images: r.media.map((m) => mediaUrl.get(m.id)).filter((u): u is string => Boolean(u)),
      createdAt: r.createdAt.toISOString().slice(0, 10),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const ids = form.getAll("id").map(String).slice(0, 100);

  let changed: { products: string[]; files: string[] } = { products: [], files: [] };
  if (intent === "publish" || intent === "reject" || intent === "pending") {
    const status: ReviewStatus =
      intent === "publish" ? "published" : intent === "reject" ? "rejected" : "pending";
    changed = await moderate(shop.id, ids, { type: "status", status });
  } else if (intent === "delete") {
    changed = await moderate(shop.id, ids, { type: "delete" });
  } else if (intent === "reply") {
    await moderate(shop.id, ids, { type: "reply", reply: String(form.get("reply") ?? "") });
  } else {
    return { ok: false as const };
  }
  // রেটিং বদলেছে এমন প্রোডাক্টের metafield আবার হিসাব (থিমের স্টার ঠিক থাকে)
  if (changed.files.length > 0) await deleteMediaFiles(admin, changed.files);
  await Promise.all(
    changed.products.map((productId) =>
      syncProductRating(admin, shop.id, productId).catch((error) =>
        console.warn("[reviews] rating sync failed", error),
      ),
    ),
  );
  return { ok: true as const, intent };
};

type Row = Awaited<ReturnType<typeof loader>>["reviews"][number];

function Stars({ value }: { value: number }) {
  return (
    <s-text>
      <span aria-label={`${value}/5`}>{"★".repeat(value) + "☆".repeat(5 - value)}</span>
    </s-text>
  );
}

function ReviewRow({ review, status }: { review: Row; status: ReviewStatus }) {
  const t = useT();
  const fetcher = useFetcher<typeof action>();
  const [reply, setReply] = useState(review.reply ?? "");
  const [replying, setReplying] = useState(false);
  const busy = fetcher.state !== "idle";

  const send = (intent: string, extra: Record<string, string> = {}) =>
    fetcher.submit({ intent, id: review.id, ...extra }, { method: "POST" });

  return (
    <s-section>
      <s-stack direction="block" gap="small-200">
        <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
          <s-stack direction="inline" gap="small" alignItems="center">
            <Stars value={review.rating} />
            <s-text type="strong">{review.authorName}</s-text>
            {review.authorEmail && <s-text color="subdued">{review.authorEmail}</s-text>}
          </s-stack>
          <s-text color="subdued">{review.createdAt}</s-text>
        </s-stack>
        <s-text color="subdued">{review.product ?? t("reviews.storeReview")}</s-text>
        {review.title && <s-text type="strong">{review.title}</s-text>}
        <s-paragraph>{review.body}</s-paragraph>
        {review.images.length > 0 && (
          <s-stack direction="inline" gap="small">
            {review.images.map((src) => (
              <s-link key={src} href={src} target="_blank">
                <s-thumbnail src={src} alt={t("reviews.photo")} size="small" />
              </s-link>
            ))}
          </s-stack>
        )}
        {review.reply && !replying && (
          <s-box padding="small" background="subdued" borderRadius="base">
            <s-text type="strong">{t("reviews.yourReply")}</s-text>
            <s-paragraph>{review.reply}</s-paragraph>
          </s-box>
        )}
        {replying && (
          <s-stack direction="block" gap="small-200">
            <s-text-area
              label={t("reviews.reply")}
              value={reply}
              rows={3}
              maxLength={2000}
              onInput={(e) => setReply(e.currentTarget.value)}
            />
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                {...(busy ? { loading: true } : {})}
                onClick={() => {
                  send("reply", { reply });
                  setReplying(false);
                }}
              >
                {t("reviews.saveReply")}
              </s-button>
              <s-button variant="tertiary" onClick={() => setReplying(false)}>
                {t("reviews.cancel")}
              </s-button>
            </s-stack>
          </s-stack>
        )}
        <s-stack direction="inline" gap="small">
          {status !== "published" && (
            <s-button
              variant="primary"
              {...(busy ? { loading: true } : {})}
              onClick={() => send("publish")}
            >
              {t("reviews.publish")}
            </s-button>
          )}
          {status !== "rejected" && (
            <s-button {...(busy ? { disabled: true } : {})} onClick={() => send("reject")}>
              {t("reviews.reject")}
            </s-button>
          )}
          {!replying && (
            <s-button variant="tertiary" onClick={() => setReplying(true)}>
              {review.reply ? t("reviews.editReply") : t("reviews.reply")}
            </s-button>
          )}
          <s-button
            variant="tertiary"
            tone="critical"
            {...(busy ? { disabled: true } : {})}
            onClick={() => {
              if (window.confirm(t("reviews.confirmDelete"))) send("delete");
            }}
          >
            {t("reviews.delete")}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export default function ReviewsPage() {
  const { status, page, hasMore, counts, toolEnabled, reviews } = useLoaderData<typeof loader>();
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const shopify = useAppBridge();
  const bulk = useFetcher<typeof action>();

  useEffect(() => {
    if (bulk.state === "idle" && bulk.data?.ok) shopify.toast.show(t("reviews.updated"));
  }, [bulk.state, bulk.data, shopify, t]);

  const go = (next: Record<string, string>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) q.set(k, v);
    navigate(`?${q}`);
  };

  return (
    <s-page heading={t("nav.reviews")}>
      <s-button slot="secondary-actions" href="/app/reviews/import">
        {t("reviews.import.title")}
      </s-button>
      {status === "pending" && reviews.length > 0 && (
        <s-button
          slot="primary-action"
          variant="primary"
          {...(bulk.state !== "idle" ? { loading: true } : {})}
          onClick={() => {
            const data = new FormData();
            data.set("intent", "publish");
            for (const r of reviews) data.append("id", r.id);
            bulk.submit(data, { method: "POST" });
          }}
        >
          {t("reviews.publishAll")}
        </s-button>
      )}

      {!toolEnabled && (
        <s-banner tone="warning">
          {t("reviews.toolOff")}{" "}
          <s-link href="/app/tools/product-reviews">{t("tools.configure")}</s-link>
        </s-banner>
      )}

      <s-section>
        <s-stack direction="inline" gap="small">
          {REVIEW_STATUSES.map((s) => (
            <s-button
              key={s}
              variant={s === status ? "primary" : "secondary"}
              onClick={() => go({ status: s, page: "1" })}
            >
              {`${t(`reviews.status.${s}`)} (${counts[s]})`}
            </s-button>
          ))}
        </s-stack>
      </s-section>

      {reviews.length === 0 ? (
        <s-section>
          <s-text color="subdued">{t("reviews.empty")}</s-text>
        </s-section>
      ) : (
        reviews.map((review) => <ReviewRow key={review.id} review={review} status={status} />)
      )}

      {(page > 1 || hasMore) && (
        <s-section>
          <s-stack direction="inline" gap="small">
            {page > 1 && (
              <s-button onClick={() => go({ page: String(page - 1) })}>
                {t("reviews.prev")}
              </s-button>
            )}
            {hasMore && (
              <s-button onClick={() => go({ page: String(page + 1) })}>
                {t("reviews.next")}
              </s-button>
            )}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
