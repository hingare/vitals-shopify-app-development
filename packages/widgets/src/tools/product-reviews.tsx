import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ToolContext } from "../types";
import { widgetT, type WidgetString } from "../i18n";
import { track } from "../analytics";

const TOOL_ID = "product-reviews";
const ENDPOINT = "/apps/app-tools/reviews";

interface Settings {
  perPage: number;
  showForm: boolean;
  starColor: string;
}

interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  verified: boolean;
  reply: string | null;
  createdAt: string;
}

interface Page {
  summary: { average: number; count: number; distribution: number[] };
  page: number;
  hasMore: boolean;
  reviews: Review[];
}

type T = (key: WidgetString) => string;

/** শুধু স্ক্রিন রিডার পড়বে */
const srOnly = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

function Stars({ value, color, size = 16 }: { value: number; color: string; size?: number }) {
  return (
    <span aria-hidden="true" style={{ color, fontSize: `${size}px`, letterSpacing: "1px" }}>
      {[1, 2, 3, 4, 5].map((i) => (i <= Math.round(value) ? "★" : "☆")).join("")}
    </span>
  );
}

function ReviewItem({ review, color, t }: { review: Review; color: string; t: T }) {
  return (
    <li style={{ padding: "16px 0", borderTop: "1px solid rgba(0,0,0,.1)", listStyle: "none" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <Stars value={review.rating} color={color} />
        <span style={srOnly}>{`${review.rating} / 5`}</span>
        <strong>{review.authorName}</strong>
        {review.verified && (
          <span style={{ fontSize: "12px", opacity: 0.7 }}>✓ {t("verified")}</span>
        )}
        <span style={{ fontSize: "12px", opacity: 0.6, marginLeft: "auto" }}>
          {review.createdAt}
        </span>
      </div>
      {review.title && <p style={{ margin: "8px 0 0", fontWeight: 600 }}>{review.title}</p>}
      <p style={{ margin: "6px 0 0", whiteSpace: "pre-line" }}>{review.body}</p>
      {review.reply && (
        <div
          style={{
            margin: "10px 0 0 12px",
            padding: "8px 12px",
            borderLeft: `3px solid ${color}`,
            opacity: 0.85,
          }}
        >
          <strong style={{ fontSize: "13px" }}>{t("storeReply")}</strong>
          <p style={{ margin: "4px 0 0", whiteSpace: "pre-line" }}>{review.reply}</p>
        </div>
      )}
    </li>
  );
}

const field = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: "10px",
  margin: "4px 0 12px",
  font: "inherit",
  border: "1px solid rgba(0,0,0,.25)",
  borderRadius: "6px",
} as const;

function ReviewForm({
  productId,
  color,
  t,
  onDone,
}: {
  productId: string;
  color: string;
  t: T;
  onDone: (status: string) => void;
}) {
  const [rating, setRating] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: Event) {
    e.preventDefault();
    if (rating === 0) {
      setError(t("chooseRating"));
      return;
    }
    const data = Object.fromEntries(new FormData(e.currentTarget as HTMLFormElement));
    setSending(true);
    setError("");
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, productId, rating }),
      });
      const json = (await res.json()) as { status?: string; error?: string };
      if (res.ok && json.status) onDone(json.status);
      else setError(t(json.error === "duplicate" ? "duplicate" : "sendFailed"));
    } catch {
      setError(t("sendFailed"));
    }
    setSending(false);
  }

  return (
    <form onSubmit={submit} style={{ margin: "16px 0", maxWidth: "560px" }}>
      <fieldset style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend>{t("yourRating")}</legend>
        {[1, 2, 3, 4, 5].map((i) => (
          <label key={i} style={{ cursor: "pointer", fontSize: "28px", color }}>
            <input
              type="radio"
              name="rating-choice"
              value={i}
              checked={rating === i}
              onChange={() => setRating(i)}
              style={{ position: "absolute", opacity: 0, width: "1px", height: "1px" }}
            />
            <span aria-hidden="true">{i <= rating ? "★" : "☆"}</span>
            <span style={srOnly}>{`${i} / 5`}</span>
          </label>
        ))}
      </fieldset>
      <label>
        {t("name")}
        <input name="name" required maxLength={80} autoComplete="name" style={field} />
      </label>
      <label>
        {t("email")}
        <input name="email" type="email" maxLength={200} autoComplete="email" style={field} />
      </label>
      <label>
        {t("reviewTitle")}
        <input name="title" maxLength={120} style={field} />
      </label>
      <label>
        {t("reviewBody")}
        <textarea name="body" required maxLength={5000} rows={4} style={field} />
      </label>
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px" }}
      />
      {error && (
        <p role="alert" style={{ color: "#B42318", margin: "0 0 12px" }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={sending}
        class="button"
        style={{ minHeight: "44px", padding: "10px 20px", cursor: "pointer" }}
      >
        {t("submitReview")}
      </button>
    </form>
  );
}

function Reviews({ productId, settings, t }: { productId: string; settings: Settings; t: T }) {
  const [data, setData] = useState<Page | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [thanks, setThanks] = useState("");
  const color = settings.starColor;

  async function load(page: number) {
    setLoading(true);
    try {
      const res = await fetch(`${ENDPOINT}?product=${productId}&page=${page}`);
      if (res.ok) {
        const json = (await res.json()) as Page;
        setData(json);
        setReviews((prev) => (page === 1 ? json.reviews : [...prev, ...json.reviews]));
      }
    } catch {
      // নেটওয়ার্ক সমস্যায় চুপচাপ খালি থাকে, পেজ ভাঙে না
    }
    setLoading(false);
  }

  useEffect(() => {
    void load(1);
  }, [productId]);

  const count = data?.summary.count ?? 0;
  return (
    <section aria-labelledby={`app-reviews-heading-${productId}`} style={{ margin: "32px 0" }}>
      <h2 id={`app-reviews-heading-${productId}`}>
        {t(productId === "store" ? "storeReviews" : "reviews")}
      </h2>
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        {count > 0 ? (
          <>
            <Stars value={data!.summary.average} color={color} size={20} />
            <span>
              {data!.summary.average.toFixed(1)} · {count}{" "}
              {t(count === 1 ? "review" : "reviewsCount")}
            </span>
          </>
        ) : (
          data && <span>{t("noReviews")}</span>
        )}
        {settings.showForm && !thanks && (
          <button
            type="button"
            class="button button--secondary"
            aria-expanded={formOpen}
            onClick={() => setFormOpen(!formOpen)}
            style={{
              marginLeft: "auto",
              minHeight: "44px",
              padding: "8px 16px",
              cursor: "pointer",
            }}
          >
            {t("writeReview")}
          </button>
        )}
      </div>
      {thanks && (
        <p role="status" style={{ margin: "12px 0" }}>
          {thanks}
        </p>
      )}
      {formOpen && !thanks && (
        <ReviewForm
          productId={productId}
          color={color}
          t={t}
          onDone={(status) => {
            setThanks(t(status === "published" ? "thanksPublished" : "thanksPending"));
            setFormOpen(false);
            if (status === "published") void load(1);
          }}
        />
      )}
      <ul style={{ padding: 0, margin: "16px 0 0" }}>
        {reviews.map((r) => (
          <ReviewItem key={r.id} review={r} color={color} t={t} />
        ))}
      </ul>
      {data?.hasMore && (
        <button
          type="button"
          class="button button--tertiary"
          disabled={loading}
          onClick={() => void load(data.page + 1)}
          style={{ minHeight: "44px", padding: "8px 16px", cursor: "pointer" }}
        >
          {t("showMore")}
        </button>
      )}
    </section>
  );
}

/** রিভিউ কোথায় বসবে: থিমের app block থাকলে সেখানে, নইলে প্রোডাক্ট সেকশনের ঠিক পরে */
function findHost(): HTMLElement {
  const block = document.querySelector<HTMLElement>("[data-app-reviews]");
  if (block) return block;
  const host = document.createElement("div");
  host.id = "app-product-reviews";
  const anchor =
    document
      .querySelector('main [id^="MainProduct"], main [id*="__main"]')
      ?.closest(".shopify-section") ?? document.querySelector("main .shopify-section");
  if (anchor) anchor.after(host);
  else (document.querySelector("main") ?? document.body).appendChild(host);
  return host;
}

export function mount({ config, settings }: ToolContext) {
  const t: T = (key) => widgetT(config.locale, key);
  const s = settings as unknown as Settings;

  // স্টোর রিভিউ: থিমের "Store reviews" ব্লক যেকোনো পেজে থাকতে পারে
  const storeHost = document.querySelector<HTMLElement>("[data-app-store-reviews]");
  if (storeHost) render(<Reviews productId="store" settings={s} t={t} />, storeHost);

  if (config.pageType !== "product") return;
  const el = document.getElementById("app-product-json");
  let productId = "";
  try {
    productId = String(
      (JSON.parse(el?.textContent ?? "{}") as { productId?: number }).productId ?? "",
    );
  } catch {
    productId = "";
  }
  if (!/^\d+$/.test(productId)) return;
  track(TOOL_ID, "view");
  render(<Reviews productId={productId} settings={s} t={t} />, findHost());
}
