import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../lib/shop.server";
import { importReviews } from "../lib/review-import.server";
import { MAX_IMPORT_ROWS } from "../lib/reviews";
import { useT } from "../lib/i18n";

const MAX_BYTES = 15 * 1024 * 1024;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const text = await request.text();
  if (text.length > MAX_BYTES) return { ok: false as const, error: "too_large" };
  const body = JSON.parse(text) as { csv?: unknown; publish?: unknown };
  if (typeof body.csv !== "string" || body.csv.trim() === "") {
    return { ok: false as const, error: "empty" };
  }
  const result = await importReviews(admin, shop.id, body.csv, { publish: body.publish === true });
  return { ok: true as const, result };
};

export default function ImportReviewsPage() {
  const t = useT();
  const fetcher = useFetcher<typeof action>();
  const [file, setFile] = useState<File | null>(null);
  const [publish, setPublish] = useState(true);
  const busy = fetcher.state !== "idle";
  const data = fetcher.data;

  async function start() {
    if (!file) return;
    const csv = await file.text();
    fetcher.submit(JSON.stringify({ csv, publish }), {
      method: "POST",
      encType: "application/json",
    });
  }

  return (
    <s-page heading={t("reviews.import.title")}>
      <s-link slot="breadcrumb-actions" href="/app/reviews">
        {t("nav.reviews")}
      </s-link>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {t("reviews.import.help", { max: MAX_IMPORT_ROWS.toLocaleString() })}
          </s-paragraph>
          <s-text color="subdued">{t("reviews.import.columns")}</s-text>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label={t("reviews.import.file")}
            onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
          />
          <s-checkbox
            label={t("reviews.import.publish")}
            checked={publish}
            onChange={(e) => setPublish(e.currentTarget.checked)}
          />
          <s-button
            variant="primary"
            {...(!file ? { disabled: true } : {})}
            {...(busy ? { loading: true } : {})}
            onClick={() => void start()}
          >
            {t("reviews.import.start")}
          </s-button>
        </s-stack>
      </s-section>

      {data && !data.ok && (
        <s-banner tone="critical">{t(`reviews.import.error.${data.error}`)}</s-banner>
      )}
      {data?.ok && (
        <s-section heading={t("reviews.import.done")}>
          <s-stack direction="block" gap="small-200">
            <s-text>{t("reviews.import.imported", { n: data.result.imported })}</s-text>
            {data.result.duplicates > 0 && (
              <s-text>{t("reviews.import.duplicates", { n: data.result.duplicates })}</s-text>
            )}
            {data.result.skipped > 0 && (
              <s-text>{t("reviews.import.skipped", { n: data.result.skipped })}</s-text>
            )}
            {data.result.tooMany && (
              <s-banner tone="warning">
                {t("reviews.import.tooMany", { max: MAX_IMPORT_ROWS.toLocaleString() })}
              </s-banner>
            )}
            {data.result.errors.map((e) => (
              <s-text key={e.line} color="subdued">
                {t("reviews.import.rowError", {
                  line: e.line,
                  reason: t(`reviews.import.reason.${e.reason}`),
                })}
              </s-text>
            ))}
            <s-button href="/app/reviews?status=published">{t("reviews.import.view")}</s-button>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
